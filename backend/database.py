from datetime import date, datetime, time, timezone
from uuid import uuid4

from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import and_, delete, insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
db = SQLAlchemy(session_options={"expire_on_commit": False})


class Result:
    def __init__(self, data):
        self.data = data


class Query:
    def __init__(self, table_name):
        self.table = db.metadata.tables.get(table_name)
        if self.table is None:
            raise ValueError("Unknown database table.")
        self.columns = list(self.table.c)
        self.filters = []
        self.ordering = None
        self.order_desc = False
        self.row_limit = None
        self.row_offset = None
        self.operation = "select"
        self.values = None
        self.conflict = None

    def select(self, columns="*"):
        if columns != "*":
            self.columns = [self.table.c[name.strip()] for name in columns.split(",")]
        return self

    def _column(self, name):
        if name not in self.table.c:
            raise ValueError("Unknown column.")
        return self.table.c[name]

    def eq(self, name, value):
        column = self._column(name)
        self.filters.append(column.is_(None) if value is None else column == value)
        return self

    def is_(self, name, value):
        column = self._column(name)
        if value == "null":
            self.filters.append(column.is_(None))
        else:
            self.filters.append(column.is_(value))
        return self

    def in_(self, name, values):
        column = self._column(name)
        self.filters.append(column.in_(values) if values else column.is_(None))
        return self

    def gte(self, name, value):
        self.filters.append(self._column(name) >= value)
        return self

    def lte(self, name, value):
        self.filters.append(self._column(name) <= value)
        return self

    def ilike(self, name, value):
        self.filters.append(self._column(name).ilike(value))
        return self

    def order(self, name, desc=False):
        self.ordering = self._column(name)
        self.order_desc = desc
        return self

    def limit(self, value):
        self.row_limit = value
        return self

    def range(self, start, end):
        self.row_offset = start
        self.row_limit = end - start + 1
        return self

    def insert(self, values):
        self.operation, self.values = "insert", values
        return self

    def update(self, values):
        self.operation, self.values = "update", values
        return self

    def delete(self):
        self.operation = "delete"
        return self

    def upsert(self, values, on_conflict=None):
        self.operation, self.values = "upsert", values
        self.conflict = on_conflict.split(",") if on_conflict else None
        return self

    def execute(self):
        session = db.session
        try:
            if self.operation == "select":
                statement = select(*self.columns).select_from(self.table)
                if self.filters:
                    statement = statement.where(and_(*self.filters))
                if self.ordering is not None:
                    statement = statement.order_by(self.ordering.desc() if self.order_desc else self.ordering.asc())
                if self.row_limit is not None:
                    statement = statement.limit(self.row_limit)
                if self.row_offset is not None:
                    statement = statement.offset(self.row_offset)
                data = [self._serialize(row) for row in session.execute(statement).mappings().all()]
                return Result(data)

            if self.operation in ("insert", "upsert"):
                values = self.values if isinstance(self.values, list) else [self.values]
                prepared = [self._prepare(dict(value)) for value in values]
                statement = insert(self.table).values(prepared)
                if self.operation == "upsert" and self.conflict:
                    if session.get_bind().dialect.name == "postgresql":
                        statement = pg_insert(self.table).values(prepared).on_conflict_do_update(
                            index_elements=self.conflict,
                            set_={key: value for key, value in prepared[0].items() if key not in self.conflict},
                        )
                    elif session.get_bind().dialect.name == "sqlite":
                        statement = sqlite_insert(self.table).values(prepared).on_conflict_do_update(
                            index_elements=self.conflict,
                            set_={key: value for key, value in prepared[0].items() if key not in self.conflict},
                        )
                if session.get_bind().dialect.name in ("postgresql", "sqlite"):
                    statement = statement.returning(*self.table.c)
                    result = session.execute(statement)
                    rows = [self._serialize(row) for row in result.mappings().all()]
                else:
                    session.execute(statement)
                    rows = []
                session.commit()
                return Result(rows)

            if not self.filters:
                raise ValueError("Updates and deletes require an explicit record scope.")
            condition = and_(*self.filters)
            if self.operation == "update":
                statement = update(self.table).where(condition).values(
                    self._prepare(dict(self.values), inserting=False)
                ).returning(*self.table.c)
                rows = [self._serialize(row) for row in session.execute(statement).mappings().all()]
            else:
                statement = delete(self.table).where(condition).returning(*self.table.c)
                rows = [self._serialize(row) for row in session.execute(statement).mappings().all()]
            session.commit()
            return Result(rows)
        except Exception:
            session.rollback()
            raise

    def _prepare(self, values, inserting=True):
        now = datetime.now(timezone.utc).isoformat()
        if inserting and "id" in self.table.c and values.get("id") is None:
            values["id"] = str(uuid4())
        if inserting and "created_at" in self.table.c:
            values.setdefault("created_at", now)
        if "updated_at" in self.table.c:
            values.setdefault("updated_at", now)
        for key, value in list(values.items()):
            if value == "now()":
                values[key] = now
        return values

    @staticmethod
    def _serialize(row):
        result = {}
        for key, value in row.items():
            if isinstance(value, (date, datetime, time)):
                value = value.isoformat()
            result[key] = value
        return result


class Database:
    def table(self, name):
        return Query(name)
