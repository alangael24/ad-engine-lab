from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 1080, 1920
RED = (241, 0, 52, 255)
WHITE = (255, 255, 255, 255)
FONT_PATH = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"

canvas = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
draw = ImageDraw.Draw(canvas)
font = ImageFont.truetype(FONT_PATH, 58)

lines = [
    "Prueba este formato en tu próxima",
    "campaña de anuncios",
]

line_metrics = []
for line in lines:
    box = draw.textbbox((0, 0), line, font=font, stroke_width=1)
    line_metrics.append((box[2] - box[0], box[3] - box[1]))

center_y = 930
gap = 8
total_height = sum(height + 34 for _, height in line_metrics) + gap
y = center_y - total_height // 2

for line, (text_width, text_height) in zip(lines, line_metrics):
    pad_x, pad_y = 28, 17
    box_width = text_width + pad_x * 2
    box_height = text_height + pad_y * 2
    x = (WIDTH - box_width) // 2
    draw.rounded_rectangle(
        (x, y, x + box_width, y + box_height),
        radius=18,
        fill=RED,
    )
    draw.text(
        ((WIDTH - text_width) // 2, y + pad_y - 5),
        line,
        font=font,
        fill=WHITE,
        stroke_width=1,
        stroke_fill=(225, 225, 225, 255),
    )
    y += box_height + gap

canvas.save(
    "/Users/alan/avatarhype-local/videos/edit/animations/hook_text/overlay.png"
)
