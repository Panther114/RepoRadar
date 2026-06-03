from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from pathlib import Path
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
OUT = PUBLIC / "readme-workflow.png"
MASCOT_OUT = PUBLIC / "reporadar-mascot.png"

W, H = 1800, 1360

INK = (72, 39, 25)
INK_SOFT = (107, 67, 42)
PAPER = (253, 242, 222)
PAPER_CARD = (255, 247, 231)
CREAM = (255, 231, 183)
CREAM_2 = (255, 238, 199)
ORANGE = (207, 91, 18)
ORANGE_DARK = (139, 59, 20)
AMBER = (246, 178, 72)
GREEN = (69, 145, 96)
BLUE = (69, 116, 164)
LINE = (136, 78, 43)


@dataclass(frozen=True)
class Box:
    name: str
    xy: tuple[int, int, int, int]


class LayoutAudit:
    def __init__(self) -> None:
        self.boxes: list[Box] = []
        self.text_boxes: list[Box] = []

    def add_box(self, name: str, xy: tuple[int, int, int, int]) -> None:
        x1, y1, x2, y2 = xy
        if not (0 <= x1 < x2 <= W and 0 <= y1 < y2 <= H):
            raise ValueError(f"{name} outside canvas: {xy}")
        self.boxes.append(Box(name, xy))

    def add_text(self, name: str, xy: tuple[int, int, int, int], container: tuple[int, int, int, int]) -> None:
        x1, y1, x2, y2 = xy
        cx1, cy1, cx2, cy2 = container
        if x1 < cx1 or y1 < cy1 or x2 > cx2 or y2 > cy2:
            raise ValueError(f"{name} text overflows {container}: {xy}")
        self.text_boxes.append(Box(name, xy))

    def assert_no_same_band_overlaps(self) -> None:
        for i, a in enumerate(self.boxes):
            for b in self.boxes[i + 1 :]:
                if a.name.split(":")[0] != b.name.split(":")[0]:
                    continue
                ax1, ay1, ax2, ay2 = a.xy
                bx1, by1, bx2, by2 = b.xy
                if ax1 < bx2 and ax2 > bx1 and ay1 < by2 and ay2 > by1:
                    raise ValueError(f"overlap: {a.name} {a.xy} with {b.name} {b.xy}")


def roca(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(PUBLIC / "roca.ttf"), size=size)


def ui_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "seguisb.ttf" if bold else "segoeui.ttf"
    path = Path("C:/Windows/Fonts") / name
    if path.exists():
        return ImageFont.truetype(str(path), size=size)
    return roca(size)


def bbox(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont) -> tuple[int, int, int, int]:
    return draw.textbbox((0, 0), text, font=font)


def draw_center(
    draw: ImageDraw.ImageDraw,
    audit: LayoutAudit,
    name: str,
    text: str,
    center: tuple[int, int],
    font: ImageFont.FreeTypeFont,
    fill=INK,
    container: tuple[int, int, int, int] | None = None,
) -> None:
    x, y = center
    b = bbox(draw, text, font)
    tw, th = b[2] - b[0], b[3] - b[1]
    tx, ty = int(x - tw / 2), int(y - th / 2)
    draw.text((tx, ty), text, font=font, fill=fill)
    if container:
        audit.add_text(name, (tx, ty, tx + tw, ty + th), container)


def section_label(
    draw: ImageDraw.ImageDraw,
    audit: LayoutAudit,
    name: str,
    text: str,
    center: tuple[int, int],
    font: ImageFont.FreeTypeFont,
) -> None:
    b = bbox(draw, text, font)
    tw, th = b[2] - b[0], b[3] - b[1]
    x, y = center
    bg = (int(x - tw / 2 - 18), int(y - th / 2 - 7), int(x + tw / 2 + 18), int(y + th / 2 + 9))
    draw.rounded_rectangle(bg, radius=8, fill=(255, 249, 235))
    draw_center(draw, audit, name, text, center, font, INK, bg)


def fit_center(
    draw: ImageDraw.ImageDraw,
    audit: LayoutAudit,
    name: str,
    text: str,
    box_xy: tuple[int, int, int, int],
    size: int,
    fill=INK,
    bold: bool = False,
    face: str = "ui",
    pad: int = 18,
) -> None:
    x1, y1, x2, y2 = box_xy
    max_w = x2 - x1 - pad * 2
    max_h = y2 - y1 - pad * 2
    for s in range(size, 11, -1):
        fnt = roca(s) if face == "roca" else ui_font(s, bold=bold)
        b = bbox(draw, text, fnt)
        if b[2] - b[0] <= max_w and b[3] - b[1] <= max_h:
            draw_center(draw, audit, name, text, ((x1 + x2) // 2, (y1 + y2) // 2), fnt, fill, box_xy)
            return
    raise ValueError(f"could not fit text {name}: {text}")


def rounded(
    draw: ImageDraw.ImageDraw,
    audit: LayoutAudit,
    name: str,
    xy: tuple[int, int, int, int],
    radius: int,
    fill,
    outline=INK,
    width: int = 3,
) -> None:
    audit.add_box(name, xy)
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def arrow(
    draw: ImageDraw.ImageDraw,
    start: tuple[int, int],
    end: tuple[int, int],
    color=ORANGE_DARK,
    width: int = 5,
) -> None:
    x1, y1 = start
    x2, y2 = end
    draw.line((x1, y1, x2, y2), fill=color, width=width)
    if x2 >= x1:
        head = [(x2, y2), (x2 - 18, y2 - 10), (x2 - 18, y2 + 10)]
    else:
        head = [(x2, y2), (x2 + 18, y2 - 10), (x2 + 18, y2 + 10)]
    draw.polygon(head, fill=color)


def down_arrow(draw: ImageDraw.ImageDraw, start: tuple[int, int], end: tuple[int, int], color=ORANGE_DARK) -> None:
    x1, y1 = start
    x2, y2 = end
    draw.line((x1, y1, x2, y2), fill=color, width=5)
    draw.polygon([(x2, y2), (x2 - 10, y2 - 18), (x2 + 10, y2 - 18)], fill=color)


def make_mascot() -> Image.Image:
    src = Image.open(PUBLIC / "icon.png").convert("RGBA").resize((640, 640), Image.Resampling.LANCZOS)
    pix = src.load()
    w, h = src.size
    seen = [[False] * h for _ in range(w)]
    queue: deque[tuple[int, int]] = deque([(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)])
    for x, y in queue:
        seen[x][y] = True

    def is_bg(pixel: tuple[int, int, int, int]) -> bool:
        r, g, b, a = pixel
        return a < 20 or (r < 72 and g < 68 and b < 68)

    while queue:
        x, y = queue.popleft()
        if not is_bg(pix[x, y]):
            continue
        pix[x, y] = (0, 0, 0, 0)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[nx][ny]:
                seen[nx][ny] = True
                queue.append((nx, ny))

    alpha = src.split()[-1].filter(ImageFilter.GaussianBlur(0.35))
    src.putalpha(alpha)
    crop = src.crop((52, 58, 600, 640))
    crop.save(MASCOT_OUT)
    return crop


def paper_background() -> Image.Image:
    random.seed(41)
    img = Image.new("RGB", (W, H), PAPER)
    for _ in range(12000):
        x = random.randrange(W)
        y = random.randrange(H)
        delta = random.randint(-6, 6)
        base = img.getpixel((x, y))
        img.putpixel((x, y), tuple(max(0, min(255, v + delta)) for v in base))
    return img


def browser_card(
    draw: ImageDraw.ImageDraw,
    audit: LayoutAudit,
    x: int,
    title: str,
    subtitle: str,
    symbol: str,
) -> tuple[int, int, int, int]:
    box_xy = (x, 232, x + 300, 374)
    rounded(draw, audit, f"top:{title}", box_xy, 13, PAPER_CARD, INK, 3)
    x1, y1, x2, _ = box_xy
    draw.rounded_rectangle((x1, y1, x2, y1 + 30), radius=13, fill=(247, 193, 111), outline=INK, width=3)
    for i, c in enumerate([(220, 105, 33), (237, 158, 44), (122, 158, 82)]):
        draw.ellipse((x1 + 20 + i * 24, y1 + 10, x1 + 32 + i * 24, y1 + 22), fill=c)
    fit_center(draw, audit, f"top-symbol:{title}", symbol, (x1 + 70, y1 + 54, x2 - 70, y1 + 108), 38, ORANGE_DARK, True, pad=4)
    fit_center(draw, audit, f"top-title:{title}", title, (x1 + 8, y1 + 168, x2 - 8, y1 + 214), 34, INK, face="roca", pad=8)
    fit_center(draw, audit, f"top-sub:{title}", subtitle, (x1 + 8, y1 + 214, x2 - 8, y1 + 258), 23, INK_SOFT, face="roca", pad=8)
    return box_xy


def service_tile(
    draw: ImageDraw.ImageDraw,
    audit: LayoutAudit,
    xy: tuple[int, int, int, int],
    title: str,
    detail: str,
    symbol: str,
    color,
) -> None:
    rounded(draw, audit, f"service:{title}", xy, 12, CREAM, None, 0)
    x1, y1, x2, y2 = xy
    icon_w = 64
    icon_x = (x1 + x2 - icon_w) // 2
    icon = (icon_x, y1 + 18, icon_x + icon_w, y1 + 82)
    draw.rounded_rectangle(icon, radius=10, fill=color, outline=INK, width=3)
    fit_center(draw, audit, f"service-symbol:{title}", symbol, icon, 29, (255, 242, 217), face="roca", pad=4)
    fit_center(draw, audit, f"service-title:{title}", title, (x1 + 14, y1 + 88, x2 - 14, y1 + 130), 27, INK, face="roca", pad=4)
    fit_center(draw, audit, f"service-detail:{title}", detail, (x1 + 14, y1 + 128, x2 - 14, y2 - 8), 23, INK_SOFT, face="roca", pad=4)


def engine_step(
    draw: ImageDraw.ImageDraw,
    audit: LayoutAudit,
    xy: tuple[int, int, int, int],
    n: str,
    title: str,
    detail: str,
    fill,
) -> None:
    rounded(draw, audit, f"engine:{title}", xy, 12, (255, 232, 185), INK, 3)
    x1, y1, x2, y2 = xy
    draw.rounded_rectangle((x1, y1, x2, y1 + 48), radius=12, fill=fill, outline=INK, width=3)
    badge = (x1 + 16, y1 + 11, x1 + 48, y1 + 39)
    draw.ellipse(badge, fill=PAPER_CARD, outline=INK, width=2)
    fit_center(draw, audit, f"engine-num:{title}", n, badge, 18, ORANGE_DARK, face="roca", pad=3)
    title_fill = PAPER_CARD if fill in (ORANGE, GREEN) else INK
    fit_center(draw, audit, f"engine-title:{title}", title, (x1 + 54, y1 + 7, x2 - 14, y1 + 44), 25, title_fill, face="roca", pad=4)
    fit_center(draw, audit, f"engine-detail:{title}", detail, (x1 + 18, y1 + 62, x2 - 18, y2 - 14), 22, INK, face="roca", pad=4)


def data_card(
    draw: ImageDraw.ImageDraw,
    audit: LayoutAudit,
    xy: tuple[int, int, int, int],
    title: str,
    detail: str,
    symbol: str,
) -> None:
    rounded(draw, audit, f"data:{title}", xy, 14, CREAM_2, None, 0)
    x1, y1, x2, y2 = xy
    fit_center(draw, audit, f"data-title:{title}", title, (x1 + 16, y1 + 16, x2 - 16, y1 + 62), 27, INK, face="roca", pad=4)
    draw.line((x1 + 30, y1 + 70, x2 - 30, y1 + 70), fill=(195, 125, 53), width=2)
    fit_center(draw, audit, f"data-detail:{title}", detail, (x1 + 18, y1 + 82, x2 - 18, y1 + 128), 22, INK_SOFT, face="roca", pad=4)
    fit_center(draw, audit, f"data-symbol:{title}", symbol, (x1 + 28, y1 + 130, x2 - 28, y2 - 12), 36, ORANGE_DARK, True, pad=2)


def main() -> None:
    audit = LayoutAudit()
    mascot = make_mascot()
    img = paper_background()
    draw = ImageDraw.Draw(img)

    rounded(draw, audit, "frame:outer", (46, 38, W - 46, H - 38), 30, (255, 249, 235), (223, 178, 111), 3)
    draw.line((130, 202, W - 130, 202), fill=LINE, width=3)

    mascot_small = mascot.resize((128, 136), Image.Resampling.LANCZOS)
    img.paste(mascot_small, (96, 54), mascot_small)
    draw.text((242, 58), "RepoRadar Core Workflow", font=roca(58), fill=INK)
    draw.text((244, 128), "Plain-English need to evidence-ranked GitHub shortlist", font=roca(30), fill=INK_SOFT)
    draw.text((W - 482, 86), "Fresh search ETA: about 70s", font=roca(31), fill=ORANGE_DARK)

    top = [
        browser_card(draw, audit, 265, "User Search", "prompt + filters", ">_"),
        browser_card(draw, audit, 750, "Ranked Results", "fit + future + underrated", "#"),
        browser_card(draw, audit, 1235, "Repo Detail", "evidence + risks", "R"),
    ]
    for left, right in zip(top, top[1:]):
        arrow(draw, (left[2] + 34, 303), (right[0] - 34, 303), width=5)

    bar = (145, 510, W - 145, 566)
    rounded(draw, audit, "bar:services", bar, 10, ORANGE, ORANGE_DARK, 4)
    draw_center(draw, audit, "bar-label:services", "Application Services", (W // 2, 538), roca(39), PAPER_CARD, bar)

    services = [
        ("Intent", "parse constraints", "I", BLUE),
        ("GitHub Search", "query variants", "G", ORANGE),
        ("Candidate Cache", "reuse fresh pools", "C", GREEN),
        ("Vector Funnel", "local embeddings", "F", AMBER),
        ("Enrichment", "README + health", "E", ORANGE),
        ("Scoring", "rank + explain", "S", GREEN),
    ]
    service_boxes: list[tuple[int, int, int, int]] = []
    start_x, gap, sw, sh = 100, 24, 250, 158
    for i, (title, detail, symbol, color) in enumerate(services):
        xy = (start_x + i * (sw + gap), 604, start_x + i * (sw + gap) + sw, 604 + sh)
        service_boxes.append(xy)
        service_tile(draw, audit, xy, title, detail, symbol, color)
    for left, right in zip(service_boxes, service_boxes[1:]):
        arrow(draw, (left[2] + 6, 683), (right[0] - 6, 683), width=4)

    draw.line((130, 830, W - 130, 830), fill=LINE, width=3)
    section_label(draw, audit, "section:core", "Core Engine", (W // 2, 830), roca(34))
    down_arrow(draw, (W // 2, 766), (W // 2, 802))

    engine_boxes = [
        (150, 878, 500, 1018),
        (535, 878, 885, 1018),
        (920, 878, 1270, 1018),
        (1305, 878, 1655, 1018),
    ]
    engine = [
        ("1", "Intent Engine", "heuristic + optional LLM intent", ORANGE),
        ("2", "Search + Cache", "GitHub candidates + query cache", AMBER),
        ("3", "Evidence Funnel", "local embeddings narrow the pool", ORANGE),
        ("4", "Score + Persist", "Fit, Future, Underrated scores", GREEN),
    ]
    for xy, item in zip(engine_boxes, engine):
        engine_step(draw, audit, xy, *item)
    for left, right in zip(engine_boxes, engine_boxes[1:]):
        arrow(draw, (left[2] + 10, 948), (right[0] - 10, 948), width=5)

    draw.line((130, 1076, W - 130, 1076), fill=LINE, width=3)
    section_label(draw, audit, "section:data", "Data Layer", (W // 2, 1076), roca(34))
    for x in (305, 707, 1092, 1478):
        down_arrow(draw, (x, 1020), (x, 1054), color=LINE)

    data = [
        ((115, 1118, 440, 1290), "GitHub API", "search, README, releases", "{}"),
        ((520, 1118, 845, 1290), "Postgres + pgvector", "jobs, caches, embeddings", "DB"),
        ((925, 1118, 1250, 1290), "Optional LLM", "intent + explanations only", "AI"),
        ((1330, 1118, 1655, 1290), "User Output", "cards, compare, detail pages", ">>"),
    ]
    for item in data:
        data_card(draw, audit, *item)

    audit.assert_no_same_band_overlaps()
    img.save(OUT, quality=96)
    print(f"wrote {OUT}")
    print(f"wrote {MASCOT_OUT}")
    print(f"layout boxes: {len(audit.boxes)}")
    print(f"text boxes checked: {len(audit.text_boxes)}")


if __name__ == "__main__":
    main()
