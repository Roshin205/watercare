"""SQLAlchemy driver for Cloudflare D1 (URL "sqlite+d1://").

D1 speaks SQLite, so SQLAlchemy's SQLite dialect writes the SQL and this module only sends it: a small DB-API 2.0
layer whose cursor runs each statement through a "runner". Inside a Worker the runner calls the D1 binding; in tests
a runner backed by Python's sqlite3 stands in for D1 and behaves the same way.

D1 has no interactive transactions: every statement is committed on its own, so commit() and rollback() do nothing.
"""
import re
import sqlite3

from sqlalchemy.dialects import registry
from sqlalchemy.dialects.sqlite.pysqlite import SQLiteDialect_pysqlite

apilevel = "2.0"
threadsafety = 1
paramstyle = "qmark"
sqlite_version_info = (3, 45, 0)
sqlite_version = "3.45.0"


class Warning(Exception):  # noqa: A001 - DB-API names
    pass


class Error(Exception):
    pass


class InterfaceError(Error):
    pass


class DatabaseError(Error):
    pass


class DataError(DatabaseError):
    pass


class OperationalError(DatabaseError):
    pass


class IntegrityError(DatabaseError):
    pass


class InternalError(DatabaseError):
    pass


class ProgrammingError(DatabaseError):
    pass


class NotSupportedError(DatabaseError):
    pass


ROW_RETURNING = re.compile(r"^\s*(SELECT|WITH|PRAGMA|VALUES|EXPLAIN)\b|\bRETURNING\b", re.IGNORECASE | re.DOTALL)
_runner = None


def use_runner(runner):
    """Send statements to `runner(sql, params, returns_rows) -> (columns, rows, changes, last_row_id)`."""
    global _runner
    _runner = runner


def _run(sql, params):
    runner = _runner or workers_runner
    try:
        return runner(sql, params, bool(ROW_RETURNING.search(sql)))
    except Error:
        raise
    except Exception as error:
        message = str(error)
        kind = IntegrityError if "constraint" in message.lower() else OperationalError
        raise kind(message) from error


def workers_runner(sql, params, returns_rows):
    """Run one statement on the request's D1 binding (env.DB)."""
    from js import JSON, Object
    from pyodide.ffi import run_sync, to_js

    from backend.runtime import worker_env

    env = worker_env()
    if env is None:
        raise InterfaceError("D1 is only reachable while handling a Worker request.")
    null = JSON.parse("null")
    values = [null if value is None else int(value) if isinstance(value, bool) else
              to_js(value) if isinstance(value, (bytes, bytearray, memoryview)) else value for value in params]
    statement = env.DB.prepare(sql)
    if values:
        statement = statement.bind(*values)
    if returns_rows:
        raw = run_sync(statement.raw(to_js({"columnNames": True}, dict_converter=Object.fromEntries)))
        raw = raw.to_py() if hasattr(raw, "to_py") else list(raw)
        columns = list(raw[0]) if raw else []
        return columns, [tuple(row) for row in raw[1:]], -1, None
    result = run_sync(statement.run())
    meta = result.meta
    return None, [], int(meta.changes or 0), meta.last_row_id


class SQLiteRunner:
    """D1 stand-in for tests and local checks: same autocommit behaviour, backed by an sqlite3 database."""

    def __init__(self, path=":memory:"):
        self.connection = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.connection.execute("PRAGMA foreign_keys = ON")

    def __call__(self, sql, params, returns_rows):
        cursor = self.connection.execute(sql, params)
        if returns_rows:
            columns = [column[0] for column in cursor.description or []]
            return columns, cursor.fetchall(), -1, None
        return None, [], cursor.rowcount, cursor.lastrowid


class Cursor:
    arraysize = 1

    def __init__(self, connection):
        self.connection = connection
        self.description = None
        self.rowcount = -1
        self.lastrowid = None
        self._rows = []

    def execute(self, sql, parameters=()):
        columns, rows, changes, last_row_id = _run(sql, tuple(parameters or ()))
        self.description = tuple((name, None, None, None, None, None, None) for name in columns) if columns is not None else None
        self._rows = [tuple(row) for row in rows]
        self.rowcount = changes
        self.lastrowid = last_row_id
        return self

    def executemany(self, sql, seq_of_parameters):
        total = 0
        for parameters in seq_of_parameters:
            self.execute(sql, parameters)
            total += max(self.rowcount, 0)
        self.rowcount = total
        return self

    def fetchone(self):
        return self._rows.pop(0) if self._rows else None

    def fetchmany(self, size=None):
        size = size or self.arraysize
        rows, self._rows = self._rows[:size], self._rows[size:]
        return rows

    def fetchall(self):
        rows, self._rows = self._rows, []
        return rows

    def __iter__(self):
        while self._rows:
            yield self._rows.pop(0)

    def close(self):
        self._rows = []

    def setinputsizes(self, sizes):
        pass

    def setoutputsize(self, size, column=None):
        pass


class Connection:
    def cursor(self):
        return Cursor(self)

    def commit(self):
        pass

    def rollback(self):
        pass

    def close(self):
        pass

    def create_function(self, *args, **kwargs):
        pass


def connect(*args, **kwargs):
    return Connection()


class D1Dialect(SQLiteDialect_pysqlite):
    driver = "d1"
    supports_statement_cache = True

    @classmethod
    def import_dbapi(cls):
        import backend.d1 as module

        return module

    def create_connect_args(self, url):
        return [], {}

    def on_connect(self):
        return None

    def get_isolation_level(self, dbapi_connection):
        return "SERIALIZABLE"

    def set_isolation_level(self, dbapi_connection, level):
        pass

    def _get_server_version_info(self, connection):
        return sqlite_version_info


registry.register("sqlite.d1", "backend.d1", "D1Dialect")
