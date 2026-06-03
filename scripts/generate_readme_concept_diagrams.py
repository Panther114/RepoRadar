from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

import generate_readme_workflow as base


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
PROBLEM_OUT = PUBLIC / "readme-github-search-problem.png"
RANKING_OUT = PUBLIC / "readme-evidence-ranking.png"


def header(
    img: Image.Image,
    draw: ImageDraw.ImageDraw,
    audit: base.LayoutAudit,
    title: str,
    subtitle: str,
    eta: str | None = None,
) -> None:
    mascot = base.make_mascot().resize((128, 136), Image.Resampling.LANCZOS)
    img.paste(mascot, (96, 54), mascot)
    draw.text((242, 58), title, font=base.roca(58), fill=base.INK)
    draw.text((244, 128), subtitle, font=base.roca(30), fill=base.INK_SOFT)
    if eta:
        draw.text((base.W - 500, 86), eta, font=base.roca(31), fill=base.ORANGE_DARK)
    draw.line((130, 202, base.W - 130, 202), fill=base.LINE, width=3)


def fit_lines(
    draw: ImageDraw.ImageDraw,
    audit: base.LayoutAudit,
    name: str,
    lines: list[str],
    xy: tuple[int, int, int, int],
    size: int,
    fill=base.INK,
) -> None:
    x1, y1, x2, y2 = xy
    for s in range(size, 11, -1):
        font = base.roca(s)
        boxes = [base.bbox(draw, line, font) for line in lines]
        widths = [box[2] - box[0] for box in boxes]
        heights = [box[3] - box[1] for box in boxes]
        line_gap = max(8, s // 3)
        total_h = sum(heights) + line_gap * (len(lines) - 1)
        if max(widths) <= x2 - x1 - 18 and total_h <= y2 - y1 - 18:
            y = y1 + ((y2 - y1) - total_h) // 2
            for i, line in enumerate(lines):
                box = boxes[i]
                tw = box[2] - box[0]
                th = box[3] - box[1]
                tx = x1 + ((x2 - x1) - tw) // 2
                draw.text((tx, y), line, font=font, fill=fill)
                audit.add_text(f"{name}:{i}", (tx, y, tx + tw, y + th), xy)
                y += th + line_gap
            return
    raise ValueError(f"could not fit lines {name}: {lines}")


def pill(
    draw: ImageDraw.ImageDraw,
    audit: base.LayoutAudit,
    xy: tuple[int, int, int, int],
    text: str,
    fill=base.CREAM,
) -> None:
    base.rounded(draw, audit, f"pill:{text}", xy, 10, fill, base.LINE, 2)
    base.fit_center(draw, audit, f"pill-text:{text}", text, xy, 25, base.INK, face="roca", pad=10)


def problem_card(
    draw: ImageDraw.ImageDraw,
    audit: base.LayoutAudit,
    xy: tuple[int, int, int, int],
    title: str,
    detail: list[str],
    symbol: str,
    fill,
) -> None:
    base.rounded(draw, audit, f"problem:{title}", xy, 18, base.PAPER_CARD, base.INK, 3)
    x1, y1, x2, y2 = xy
    draw.rounded_rectangle((x1, y1, x2, y1 + 68), radius=18, fill=fill, outline=base.INK, width=3)
    base.fit_center(draw, audit, f"problem-symbol:{title}", symbol, (x1 + 26, y1 + 13, x1 + 92, y1 + 58), 34, base.PAPER_CARD, True, pad=4)
    base.fit_center(draw, audit, f"problem-title:{title}", title, (x1 + 104, y1 + 10, x2 - 24, y1 + 60), 32, base.PAPER_CARD, face="roca", pad=4)
    fit_lines(draw, audit, f"problem-detail:{title}", detail, (x1 + 30, y1 + 92, x2 - 30, y2 - 28), 31, base.INK)


def result_tile(
    draw: ImageDraw.ImageDraw,
    audit: base.LayoutAudit,
    xy: tuple[int, int, int, int],
    title: str,
    detail: str,
    color,
) -> None:
    base.rounded(draw, audit, f"result:{title}", xy, 16, color, base.INK, 3)
    x1, y1, x2, y2 = xy
    base.fit_center(draw, audit, f"result-title:{title}", title, (x1 + 20, y1 + 22, x2 - 20, y1 + 78), 35, base.PAPER_CARD, face="roca", pad=4)
    base.fit_center(draw, audit, f"result-detail:{title}", detail, (x1 + 24, y1 + 84, x2 - 24, y2 - 14), 27, base.PAPER_CARD, face="roca", pad=4)


def evidence_card(
    draw: ImageDraw.ImageDraw,
    audit: base.LayoutAudit,
    xy: tuple[int, int, int, int],
    title: str,
    detail: list[str],
    symbol: str,
) -> None:
    base.rounded(draw, audit, f"evidence:{title}", xy, 16, base.CREAM_2, base.LINE, 2)
    x1, y1, x2, y2 = xy
    height = y2 - y1
    if height < 205:
        base.fit_center(draw, audit, f"evidence-title:{title}", title, (x1 + 16, y1 + 16, x2 - 16, y1 + 58), 32, base.INK, face="roca", pad=4)
        draw.line((x1 + 34, y1 + 68, x2 - 34, y1 + 68), fill=(195, 125, 53), width=3)
        fit_lines(draw, audit, f"evidence-detail:{title}", detail, (x1 + 22, y1 + 80, x2 - 22, y1 + 128), 30, base.INK_SOFT)
        base.fit_center(draw, audit, f"evidence-symbol:{title}", symbol, (x1 + 28, y1 + 132, x2 - 28, y2 - 8), 40, base.ORANGE_DARK, True, pad=2)
        return

    base.fit_center(draw, audit, f"evidence-title:{title}", title, (x1 + 16, y1 + 20, x2 - 16, y1 + 68), 34, base.INK, face="roca", pad=4)
    draw.line((x1 + 34, y1 + 80, x2 - 34, y1 + 80), fill=(195, 125, 53), width=3)
    fit_lines(draw, audit, f"evidence-detail:{title}", detail, (x1 + 22, y1 + 92, x2 - 22, y1 + 154), 27, base.INK_SOFT)
    base.fit_center(draw, audit, f"evidence-symbol:{title}", symbol, (x1 + 28, y1 + 162, x2 - 28, y2 - 8), 42, base.ORANGE_DARK, True, pad=2)


def generate_problem() -> None:
    audit = base.LayoutAudit()
    img = base.paper_background()
    draw = ImageDraw.Draw(img)

    base.rounded(draw, audit, "frame:outer", (46, 38, base.W - 46, base.H - 38), 30, (255, 249, 235), (223, 178, 111), 3)
    header(
        img,
        draw,
        audit,
        "Why GitHub Search Misses Fit",
        "Keyword search rewards names and popularity before evidence",
    )

    query = (154, 246, 1660, 336)
    base.rounded(draw, audit, "query:bar", query, 16, base.PAPER_CARD, base.INK, 3)
    base.fit_center(draw, audit, "query:text", '"local-first collaborative markdown editor"', query, 42, base.INK, face="roca", pad=18)

    cards = [
        ((105, 395, 545, 690), "Keyword Trap", ["Exact wording wins", "over actual capability"], "K", base.ORANGE),
        ((605, 395, 1045, 690), "Star Bias", ["Famous projects float", "above better fits"], "*", base.AMBER),
        ((1105, 395, 1545, 690), "Thin Evidence", ["README matches hide", "stale maintenance"], "?", base.GREEN),
    ]
    for xy, title, detail, symbol, color in cards:
        problem_card(draw, audit, xy, title, detail, symbol, color)
        base.down_arrow(draw, ((xy[0] + xy[2]) // 2, xy[3] + 8), ((xy[0] + xy[2]) // 2, xy[3] + 70), base.ORANGE_DARK)

    misses = [
        ((142, 780, 508, 942), "Fit unseen", "different words"),
        ((642, 780, 1008, 942), "Wrong winner", "stars are not fit"),
        ((1142, 780, 1508, 942), "Risk hidden", "no health signal"),
    ]
    for xy, title, detail in misses:
        result_tile(draw, audit, xy, title, detail, base.ORANGE_DARK)

    base.draw_center(draw, audit, "bridge:label", "RepoRadar adds evidence before ranking", (base.W // 2, 1036), base.roca(54), base.INK)

    final = [
        ((112, 1110, 486, 1302), "Fit", ["need matched"], "OK"),
        ((512, 1110, 886, 1302), "Future", ["maintained"], "OK"),
        ((912, 1110, 1286, 1302), "Risk", ["flags visible"], "OK"),
        ((1312, 1110, 1686, 1302), "Underrated", ["low fame"], "OK"),
    ]
    for xy, title, detail, symbol in final:
        evidence_card(draw, audit, xy, title, detail, symbol)

    audit.assert_no_same_band_overlaps()
    img.save(PROBLEM_OUT, quality=96)
    print(f"wrote {PROBLEM_OUT}")
    print(f"layout boxes: {len(audit.boxes)}")


def score_card(
    draw: ImageDraw.ImageDraw,
    audit: base.LayoutAudit,
    xy: tuple[int, int, int, int],
    title: str,
    score: str,
    detail: str,
    color,
) -> None:
    base.rounded(draw, audit, f"score:{title}", xy, 18, base.PAPER_CARD, base.INK, 3)
    x1, y1, x2, y2 = xy
    draw.rounded_rectangle((x1, y1, x2, y1 + 82), radius=18, fill=color, outline=base.INK, width=3)
    base.fit_center(draw, audit, f"score-title:{title}", title, (x1 + 20, y1 + 18, x2 - 20, y1 + 70), 36, base.PAPER_CARD, face="roca", pad=4)
    base.fit_center(draw, audit, f"score-value:{title}", score, (x1 + 30, y1 + 112, x2 - 30, y1 + 194), 68, base.ORANGE_DARK, True, face="roca", pad=4)
    fit_lines(draw, audit, f"score-detail:{title}", detail.split("|"), (x1 + 28, y1 + 218, x2 - 28, y2 - 32), 28, base.INK_SOFT)


def generate_ranking() -> None:
    audit = base.LayoutAudit()
    img = base.paper_background()
    draw = ImageDraw.Draw(img)

    base.rounded(draw, audit, "frame:outer", (46, 38, base.W - 46, base.H - 38), 30, (255, 249, 235), (223, 178, 111), 3)
    header(
        img,
        draw,
        audit,
        "Evidence Ranked Shortlists",
        "RepoRadar scores what the repository proves, not only what it claims",
        "Fresh search ETA: about 70s",
    )

    flow = [
        ((100, 270, 430, 510), "Prompt", ["plain-English", "need"], ">_"),
        ((495, 270, 825, 510), "Candidate Pool", ["many GitHub", "hits"], "GH"),
        ((890, 270, 1220, 510), "Evidence Bundle", ["README", "health"], "EV"),
        ((1285, 270, 1615, 510), "Ranked Output", ["shortlist", "risks"], "#"),
    ]
    for xy, title, detail, symbol in flow:
        evidence_card(draw, audit, xy, title, detail, symbol)
    for left, right in zip(flow, flow[1:]):
        base.arrow(draw, (left[0][2] + 28, 390), (right[0][0] - 28, 390), base.ORANGE_DARK, 5)

    base.draw_center(draw, audit, "section:scores", "Three scores, one inspectable decision", (base.W // 2, 590), base.roca(54), base.INK)

    scores = [
        ((110, 660, 510, 1018), "Fit", "92", "semantic match|features + manifest", base.BLUE),
        ((532, 660, 932, 1018), "Future", "81", "activity + releases|issues + contributors", base.GREEN),
        ((954, 660, 1354, 1018), "Underrated", "88", "high value|low saturation", base.ORANGE),
        ((1376, 660, 1690, 1018), "Risk", "Low", "license + churn|maintenance flags", base.AMBER),
    ]
    for xy, title, score, detail, color in scores:
        score_card(draw, audit, xy, title, score, detail, color)

    base.draw_center(draw, audit, "section:bottom", "The result is a shortlist you can defend", (base.W // 2, 1088), base.roca(52), base.INK)
    bottom = [
        ((124, 1162, 564, 1296), "Best overall", "clear evidence"),
        ((674, 1162, 1114, 1296), "Best maintained", "future signal"),
        ((1224, 1162, 1664, 1296), "Hidden gem", "strong match"),
    ]
    for xy, title, detail in bottom:
        result_tile(draw, audit, xy, title, detail, base.GREEN)

    audit.assert_no_same_band_overlaps()
    img.save(RANKING_OUT, quality=96)
    print(f"wrote {RANKING_OUT}")
    print(f"layout boxes: {len(audit.boxes)}")


def main() -> None:
    generate_problem()
    generate_ranking()


if __name__ == "__main__":
    main()
