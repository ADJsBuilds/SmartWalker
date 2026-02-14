from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas


def build_daily_pdf(out_path: str, resident_id: str, date_str: str, stats: dict, struggles: list[str], suggestions: list[str]) -> None:
    c = canvas.Canvas(out_path, pagesize=letter)
    width, height = letter

    y = height - 50
    c.setFont('Helvetica-Bold', 16)
    c.drawString(50, y, f'Daily Report - Resident {resident_id}')
    y -= 24

    c.setFont('Helvetica', 11)
    c.drawString(50, y, f'Date: {date_str}')
    y -= 28

    c.setFont('Helvetica-Bold', 12)
    c.drawString(50, y, 'Key Stats')
    y -= 18
    c.setFont('Helvetica', 11)
    for k, v in stats.items():
        c.drawString(60, y, f'- {k}: {v}')
        y -= 16

    y -= 8
    c.setFont('Helvetica-Bold', 12)
    c.drawString(50, y, 'Struggles')
    y -= 18
    c.setFont('Helvetica', 11)
    for item in struggles or ['No major struggles detected.']:
        c.drawString(60, y, f'- {item}')
        y -= 16

    y -= 8
    c.setFont('Helvetica-Bold', 12)
    c.drawString(50, y, 'Suggestions')
    y -= 18
    c.setFont('Helvetica', 11)
    for item in suggestions or ['Continue current plan and monitor for changes.']:
        c.drawString(60, y, f'- {item}')
        y -= 16

    c.save()
