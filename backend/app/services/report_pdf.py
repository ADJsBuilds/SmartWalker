from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
import textwrap


def _draw_wrapped(c: canvas.Canvas, text: str, x: int, y: int, width_chars: int = 92, line_height: int = 14) -> int:
    parts = textwrap.wrap((text or '').strip(), width=width_chars) or ['']
    for line in parts:
        c.drawString(x, y, line)
        y -= line_height
    return y


def build_daily_pdf(
    out_path: str,
    resident_id: str,
    date_str: str,
    stats: dict,
    struggles: list[str],
    suggestions: list[str],
    narrative: dict | None = None,
) -> None:
    c = canvas.Canvas(out_path, pagesize=letter)
    _, height = letter

    y = height - 50
    c.setFont('Helvetica-Bold', 16)
    title = (narrative or {}).get('title') or f'Daily Report - Resident {resident_id}'
    c.drawString(50, y, title)
    y -= 24

    c.setFont('Helvetica', 11)
    c.drawString(50, y, f'Date: {date_str}')
    y -= 28

    if narrative:
        c.setFont('Helvetica-Bold', 12)
        c.drawString(50, y, 'At a glance')
        y -= 18
        c.setFont('Helvetica', 11)
        for item in (narrative.get('at_a_glance') or []):
            label = str((item or {}).get('label') or '-')
            value = str((item or {}).get('value') or '-')
            c.drawString(60, y, f'- {label}: {value}')
            y -= 16

        alerts = narrative.get('alerts') or []
        if alerts:
            y -= 4
            c.setFont('Helvetica-Bold', 12)
            c.drawString(50, y, 'Alerts')
            y -= 18
            c.setFont('Helvetica', 11)
            for item in alerts:
                sev = str((item or {}).get('severity') or 'low').upper()
                label = str((item or {}).get('label') or 'Alert')
                evidence = str((item or {}).get('evidence') or '')
                y = _draw_wrapped(c, f'- [{sev}] {label}: {evidence}', 60, y, width_chars=90)
                y -= 2

        insights = narrative.get('insights') or []
        c.setFont('Helvetica-Bold', 12)
        c.drawString(50, y, 'Insights')
        y -= 18
        c.setFont('Helvetica', 11)
        for item in insights:
            y = _draw_wrapped(c, f'- {item}', 60, y, width_chars=90)
            y -= 2

        actions = narrative.get('recommended_actions') or []
        c.setFont('Helvetica-Bold', 12)
        c.drawString(50, y, 'Recommended actions')
        y -= 18
        c.setFont('Helvetica', 11)
        for idx, item in enumerate(actions, start=1):
            priority = str((item or {}).get('priority') or 'P3')
            action = str((item or {}).get('action') or '')
            why = str((item or {}).get('why') or '')
            y = _draw_wrapped(c, f'{idx}. [{priority}] {action}', 60, y, width_chars=90)
            y = _draw_wrapped(c, f'   Why: {why}', 60, y, width_chars=88)
            y -= 2

        data_quality = narrative.get('data_quality') or {}
        c.setFont('Helvetica-Bold', 12)
        c.drawString(50, y, 'Data quality')
        y -= 18
        c.setFont('Helvetica', 11)
        dq_status = str(data_quality.get('status') or '-')
        dq_notes = str(data_quality.get('notes') or '-')
        y = _draw_wrapped(c, f'Status: {dq_status}', 60, y, width_chars=90)
        y = _draw_wrapped(c, f'Notes: {dq_notes}', 60, y, width_chars=90)
        y -= 2

        message = str(narrative.get('message_to_resident') or '')
        if message:
            c.setFont('Helvetica-Bold', 12)
            c.drawString(50, y, 'Message to resident')
            y -= 18
            c.setFont('Helvetica', 11)
            y = _draw_wrapped(c, message, 60, y, width_chars=90)
    else:
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

    disclaimer = str((narrative or {}).get('disclaimer') or '')
    if disclaimer:
        c.setFont('Helvetica-Oblique', 9)
        c.drawString(50, 40, disclaimer)

    c.save()
