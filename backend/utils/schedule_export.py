"""Client schedule layout for the Projects report: one block per client, projects listed beneath it."""
from datetime import date

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

HEADERS = ["SL NO", "Client", "", "Project", "SO Number", "Contract Period", "System Details",
           "Engineer Visit", "Microbiology", "Legionella"]
COLUMN_WIDTHS = (8, 24, 5, 28, 12, 32, 44, 16, 16, 16)


def month_year(value):
    try:
        return date.fromisoformat(str(value)[:10]).strftime("%B %Y")
    except ValueError:
        return ""


def frequency_text(frequency, custom_date):
    if not frequency:
        return ""
    return f"{frequency} ({custom_date})" if frequency == "Custom" and custom_date else frequency


def service_text(row, toggle, frequency, custom_date):
    if row.get(toggle) != "Yes":
        return "NO"
    return f"Yes {frequency_text(row.get(frequency), row.get(custom_date)).lower()}".strip()


def schedule_rows(rows, client_names):
    """One list per project. SL NO and the client name appear on the first row of each client only."""
    groups = {}
    for row in rows:
        name = row.get("client_name") or client_names.get(row.get("client_id")) or "No client"
        groups.setdefault(name, []).append(row)
    table = []
    for serial, name in enumerate(sorted(groups, key=str.lower), start=1):
        for number, row in enumerate(groups[name], start=1):
            start, end = month_year(row.get("start_date")), month_year(row.get("end_date"))
            period = f"{start} to {end}" if start and end and end != start else start or end
            table.append([
                serial if number == 1 else "", name if number == 1 else "", number, row.get("name") or "",
                row["so_no"] if row.get("so_no") is not None else "", period, row.get("system_details") or "",
                frequency_text(row.get("engineer_visit"), row.get("engineer_visit_custom_date")),
                service_text(row, "microbiology", "microbiology_frequency", "microbiology_custom_date"),
                service_text(row, "legionella", "legionella_frequency", "legionella_custom_date"),
            ])
    return table


def schedule_workbook(table, clean):
    """Build the sheet; `clean` neutralises spreadsheet formulas in user text."""
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Client schedule"
    thin = Side(style="thin", color="000000")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    green, yellow = PatternFill("solid", fgColor="92D86B"), PatternFill("solid", fgColor="FFFF00")
    sheet.append(HEADERS)
    for cell in sheet[1]:
        cell.font, cell.fill, cell.border = Font(bold=True), green, border
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    sheet.row_dimensions[1].height = 22
    block_start = 2
    for index, values in enumerate(table, start=2):
        if values[1] and index > 2:
            _merge_client(sheet, block_start, index - 1)
            block_start = index
        sheet.append([clean(value) for value in values])
        for column, cell in enumerate(sheet[index], start=1):
            cell.border = border
            cell.alignment = Alignment(
                horizontal="center" if column in (1, 3, 5) else "left", vertical="center", wrap_text=True,
            )
            if column == 3:
                cell.font = Font(bold=True)
        sheet.cell(index, 2).fill = yellow
        sheet.cell(index, 2).font = Font(bold=True)
        sheet.row_dimensions[index].height = max(20, 15 * (str(values[6]).count("\n") + 1))
    if table:
        _merge_client(sheet, block_start, len(table) + 1)
    for letter, width in zip("ABCDEFGHIJ", COLUMN_WIDTHS):
        sheet.column_dimensions[letter].width = width
    sheet.freeze_panes = "A2"
    return workbook


def _merge_client(sheet, first, last):
    if last > first:
        sheet.merge_cells(start_row=first, start_column=1, end_row=last, end_column=1)
        sheet.merge_cells(start_row=first, start_column=2, end_row=last, end_column=2)
