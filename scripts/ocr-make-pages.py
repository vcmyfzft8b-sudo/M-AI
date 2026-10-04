"""
Renders full-page "phone photos" of handwritten Slovenian notes for scripts/ocr-eval.mjs.

The first OCR fixtures were seven large lines on a 1600 px card. A learner's photo is a whole A4
page of small, uneven writing, shot at an angle and uploaded at 2000-2400 px and 0.4-0.6 MB (the
production median, Oct 2026), which the reader then sees as ~500 image tokens at medium
resolution. These pages reproduce that, with the ground truth written into evals/ocr/truth.json.

Font-rendered writing with per-letter jitter is still kinder than a real hand, so read the scores
as an upper bound and confirm on real photos.

    python3 scripts/ocr-make-pages.py

The handwriting fonts are the ones macOS ships. Elsewhere, copy the five font files listed in
PAGES into one folder, keeping the "Supplemental/" subfolder, and point OCR_FONT_DIR at it. Apple's
fonts may not be redistributed, so they are not in the repo; the rendered pages in evals/ocr are.
"""

import io
import json
import os
import random
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OCR_DIR = ROOT / "evals" / "ocr"
FONTS = os.environ.get("OCR_FONT_DIR", "/System/Library/Fonts")

PAGES = {
    "notes-pharma": {
        "font": (f"{FONTS}/Supplemental/Bradley Hand Bold.ttf", 0),
        "ink": (28, 38, 120),
        "seed": 11,
        "lines": [
            "Farmacevtska industrija - pregled",
            "1. Raziskave in razvoj (R&R)",
            "odkrivanje novih učinkovin, predklinične študije",
            "klinične študije: faza I, II, III (varnost, učinkovitost)",
            "2. Registracija zdravila - JAZMP v Sloveniji, EMA v EU",
            "dovoljenje za promet, povzetek glavnih značilnosti",
            "3. Proizvodnja po smernicah DPP (GMP)",
            "kontrola kakovosti: čistost, stabilnost, sterilnost",
            "4. Spremljanje zakonodaje - nenehne spremembe",
            "5. Farmakovigilanca (varnost zdravil)",
            "spremljanje neželenih učinkov po prihodu na trg",
            "poročila zdravnikov, farmacevtov in bolnikov",
            "ukrepi: sprememba navodil, umik zdravila s trga",
            "6. Trženje, prodaja in distribucija",
            "veletrgovina z zdravili: skladiščenje, hladna veriga",
            "lekarne in bolnišnice, recept ali brez recepta",
            "Primeri podjetij: Krka (Novo mesto), Lek (Sandoz)",
            "Krka - generična zdravila, izvoz v več kot 70 držav",
            "Patent velja 20 let, nato generiki znižajo ceno",
            "Biološka zdravila: cepiva, monoklonska protitelesa",
            "biopodobna zdravila = podobna, a ne enaka",
            "Stroški razvoja enega zdravila ~ 2 milijardi EUR",
            "le 1 od 10.000 spojin pride do trga",
            "Pomembno za izpit: faze kliničnih študij!",
        ],
    },
    "notes-history": {
        "font": (f"{FONTS}/Noteworthy.ttc", 0),
        "ink": (20, 20, 24),
        "seed": 23,
        "lines": [
            "Zgodovina - Slovenci v 19. stoletju",
            "Marčna revolucija 1848, konec absolutizma",
            "Zedinjena Slovenija: program Matije Majarja Ziljskega",
            "zahteve: vse slovenske dežele v eno upravno enoto",
            "slovenščina v šolah in uradih",
            "Bleiweisove Kmetijske in rokodelske novice (1843)",
            "Janez Bleiweis = oče naroda, staroslovenci",
            "mladoslovenci: Fran Levstik, Josip Jurčič",
            "Taborsko gibanje 1868-1871, prvi tabor v Ljutomeru",
            "čitalnice: prva v Trstu 1861, nato Maribor, Ljubljana",
            "Slovenska matica ustanovljena 1864",
            "Dualizem 1867: Avstro-Ogrska",
            "Slovenci razdeljeni med avstrijski in ogrski del",
            "Gospodarstvo: Južna železnica Dunaj-Trst (1857)",
            "industrializacija počasna, izseljevanje v Ameriko",
            "Politične stranke konec stoletja:",
            "katoliški tabor (dr. Janez Evangelist Krek)",
            "liberalni tabor (Ivan Hribar, župan Ljubljane)",
            "potres v Ljubljani 1895 - obnova mesta, Maks Fabiani",
            "Ključni pojmi: narodna prebuja, kulturni boj",
            "Ponovi: datumi taborov in imena voditeljev!",
        ],
    },
    "notes-biology": {
        "font": (f"{FONTS}/Supplemental/ChalkboardSE.ttc", 0),
        "ink": (30, 60, 140),
        "seed": 37,
        "lines": [
            "Celično dihanje",
            "glukoza + kisik -> ogljikov dioksid + voda + ATP",
            "C6H12O6 + 6 O2 -> 6 CO2 + 6 H2O",
            "1. Glikoliza - v citoplazmi, brez kisika",
            "iz glukoze nastaneta 2 molekuli piruvata, 2 ATP",
            "2. Krebsov cikel - v matriksu mitohondrija",
            "acetil-CoA, nastajajo NADH in FADH2",
            "3. Dihalna veriga - notranja membrana mitohondrija",
            "elektroni potujejo do kisika, nastane voda",
            "ATP-sintaza: kemiosmoza, protonski gradient",
            "skupaj približno 30-32 ATP na glukozo",
            "Anaerobno: mlečnokislinsko vrenje v mišicah",
            "alkoholno vrenje pri kvasovkah (etanol + CO2)",
            "Mitohondrij ima lastno DNK - endosimbiontska teorija",
            "Lynn Margulis, 1967",
            "Fotosinteza je obraten proces v kloroplastih",
            "svetlobne reakcije: tilakoide, temotne: stroma",
            "Calvinov cikel veže CO2 v sladkorje",
            "Encimi: specifični, odvisni od temperature in pH",
            "denaturacija nad 40 stopinj Celzija",
            "Za test: shema mitohondrija in bilanca ATP",
        ],
    },
    # Joined-up school cursive, which is how most Slovenian learners write.
    "notes-cursive-economics": {
        "font": (f"{FONTS}/Supplemental/SnellRoundhand.ttc", 0),
        "ink": (25, 35, 110),
        "seed": 41,
        "size": 78,
        "joined": True,
        "blur": 2.2,
        "lines": [
            "Ekonomija - ponudba in povpraševanje",
            "Zakon povpraševanja: višja cena, manjša količina",
            "Zakon ponudbe: višja cena, večja količina",
            "Ravnotežje: točka, kjer se krivulji sekata",
            "Cenovna elastičnost = sprememba količine / sprememba cene",
            "elastično povpraševanje: luksuzne dobrine",
            "neelastično: kruh, zdravila, bencin",
            "Premik krivulje: dohodek, okus, cene substitutov",
            "komplementarne dobrine: kava in sladkor",
            "Tržne oblike: popolna konkurenca, monopol, oligopol",
            "Monopol: Elektro Ljubljana, nekoč Telekom",
            "Minimalna plača - spodnja meja cene dela",
            "Inflacija merimo z indeksom cen življenjskih potrebščin",
            "Statistični urad Republike Slovenije (SURS)",
            "BDP = potrošnja + investicije + država + neto izvoz",
            "Adam Smith: nevidna roka trga, 1776",
            "John Maynard Keynes: država naj poveča porabo v krizi",
            "Za kolokvij: izračun elastičnosti in graf ravnotežja",
        ],
    },
    "notes-cursive-geography": {
        "font": (f"{FONTS}/Supplemental/Brush Script.ttf", 0),
        "ink": (15, 15, 20),
        "seed": 53,
        "size": 80,
        "joined": True,
        "blur": 2.0,
        "lines": [
            "Geografija Slovenije",
            "Površina 20.271 km2, približno 2,1 milijona prebivalcev",
            "Štiri naravne enote: alpska, dinarska, panonska, sredozemska",
            "Najvišji vrh: Triglav, 2864 m",
            "Reke: Sava, Drava, Mura, Soča, Krka, Kolpa",
            "Soča se izliva v Jadransko morje, ostale v Črno morje",
            "Kras: vrtače, kraška polja, ponikalnice",
            "Postojnska jama, Škocjanske jame (UNESCO)",
            "Cerkniško jezero je presihajoče jezero",
            "Podnebje: alpsko, celinsko, sredozemsko",
            "Burja na Primorskem, fen na Gorenjskem",
            "Panonska nižina: Prekmurje, kmetijstvo, termalni izviri",
            "Mesta: Ljubljana, Maribor, Celje, Kranj, Koper",
            "Luka Koper - edino tovorno pristanišče",
            "Gozd pokriva skoraj 60 % površja",
            "Vprašanje za test: razlike med Krasom in Alpami",
        ],
    },
}

PAGE_W, PAGE_H = 2480, 3508  # A4 at 300 dpi
LINE_GAP = 128
TOP = 330
LEFT = 230


def load_font(path, index, size):
    return ImageFont.truetype(path, size, index=index)


def draw_page(spec):
    rng = random.Random(spec["seed"])
    page = Image.new("RGB", (PAGE_W, PAGE_H), (250, 248, 240))
    draw = ImageDraw.Draw(page)

    for y in range(TOP - LINE_GAP + 40, PAGE_H - 120, LINE_GAP):
        draw.line([(0, y), (PAGE_W, y)], fill=(170, 195, 230), width=3)
    draw.line([(LEFT - 50, 0), (LEFT - 50, PAGE_H)], fill=(225, 120, 120), width=4)

    font_path, font_index = spec["font"]
    baseline = TOP

    # Cursive keeps the font's own advance so the strokes still join; print gets looser spacing.
    joined = spec.get("joined", False)
    base_size = spec.get("size", 68)

    for line in spec["lines"]:
        x = LEFT + rng.randint(-10, 30)
        drift = rng.uniform(-0.035, 0.035)  # the line wanders off the ruling
        # A writer squeezes a long line in rather than running off the page: every word in the
        # truth file has to be on the paper, or the score measures the crop, not the reader.
        natural = load_font(font_path, font_index, base_size).getlength(line) * (1.0 if joined else 1.12)
        line_size = base_size * min(1.0, (PAGE_W - LEFT - 180) / natural)

        for char in line:
            size = int(line_size * rng.uniform(0.93 if joined else 0.85, 1.07 if joined else 1.12))
            font = load_font(font_path, font_index, size)
            if char == " ":
                x += int(size * rng.uniform(0.28, 0.5))
                continue

            box = font.getbbox(char)
            glyph_w = max(1, int(font.getlength(char)) if joined else box[2] - box[0])
            tile = Image.new("RGBA", (max(glyph_w, box[2] - box[0]) + 60, size * 2), (0, 0, 0, 0))
            alpha = rng.randint(190, 255)
            ImageDraw.Draw(tile).text((30 - (0 if joined else box[0]), size // 2), char, font=font, fill=(*spec["ink"], alpha))
            tile = tile.rotate(rng.uniform(-3, 3) if joined else rng.uniform(-7, 7), resample=Image.BICUBIC, expand=False)

            y = int(baseline - size - size // 2 + 20 + (x - LEFT) * drift + rng.uniform(-6, 6))
            page.paste(tile, (x - 30, y), tile)
            x += glyph_w + (int(size * rng.uniform(-0.02, 0.02)) if joined else int(size * rng.uniform(-0.02, 0.09)))

        baseline += LINE_GAP

    return page


def perspective_coeffs(src, dst):
    """Coefficients for Image.transform(PERSPECTIVE) mapping dst quad back to src."""
    matrix = []
    for (x, y), (u, v) in zip(dst, src):
        matrix.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        matrix.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    vector = [c for pair in src for c in pair]

    # Solve the 8x8 system by Gaussian elimination (no numpy needed).
    n = 8
    aug = [row[:] + [vector[i]] for i, row in enumerate(matrix)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(aug[r][col]))
        aug[col], aug[pivot] = aug[pivot], aug[col]
        for r in range(n):
            if r != col:
                factor = aug[r][col] / aug[col][col]
                aug[r] = [a - factor * b for a, b in zip(aug[r], aug[col])]
    return [aug[i][n] / aug[i][i] for i in range(n)]


def photograph(page, seed, blur):
    rng = random.Random(seed)
    W, H = 3024, 4032  # a phone camera in portrait
    desk = Image.new("RGB", (W, H), (120, 98, 78))
    noise = Image.effect_noise((W // 8, H // 8), 40).resize((W, H)).convert("RGB")
    desk = Image.blend(desk, noise, 0.15)

    scale = 0.9
    pw, ph = int(PAGE_W * scale), int(PAGE_H * scale)
    page = page.resize((pw, ph), Image.LANCZOS)
    ox, oy = (W - pw) // 2, (H - ph) // 2
    jitter = lambda: rng.randint(-110, 110)
    dst = [(ox + jitter(), oy + jitter()), (ox + pw + jitter(), oy + jitter()),
           (ox + pw + jitter(), oy + ph + jitter()), (ox + jitter(), oy + ph + jitter())]
    src = [(0, 0), (pw, 0), (pw, ph), (0, ph)]
    warped = page.transform((W, H), Image.PERSPECTIVE, perspective_coeffs(src, dst), Image.BICUBIC)
    mask = Image.new("L", (pw, ph), 255).transform((W, H), Image.PERSPECTIVE, perspective_coeffs(src, dst), Image.BICUBIC)
    desk.paste(warped, (0, 0), mask)

    # Uneven room light: bright on one side, a soft shadow falling across the other.
    light = Image.linear_gradient("L").rotate(rng.choice([30, 140, 220])).resize((W, H))
    shade = Image.merge("RGB", [light.point(lambda v: 165 + v * 90 // 255)] * 3)
    photo = ImageChops.multiply(desk, shade)
    photo = photo.filter(ImageFilter.GaussianBlur(blur))
    photo = Image.blend(photo, Image.effect_noise((W, H), 18).convert("RGB"), 0.05)

    # What shrinkScanImageForUpload sends: long edge 2000 px at quality 0.78.
    photo.thumbnail((1500, 2000), Image.LANCZOS)
    out = io.BytesIO()
    photo.save(out, "JPEG", quality=78)
    return out.getvalue()


def main():
    missing = [spec["font"][0] for spec in PAGES.values() if not Path(spec["font"][0]).is_file()]
    if missing:
        sys.exit(
            "Missing handwriting fonts (macOS ships them; set OCR_FONT_DIR elsewhere):\n  "
            + "\n  ".join(missing)
        )

    truth_path = OCR_DIR / "truth.json"
    truth = json.loads(truth_path.read_text())

    for name, spec in PAGES.items():
        jpeg = photograph(draw_page(spec), spec["seed"] + 1, spec.get("blur", 1.6))
        (OCR_DIR / f"{name}.jpg").write_bytes(jpeg)
        truth[name] = {"typed": [], "handwritten": spec["lines"]}
        print(f"{name}.jpg  {len(jpeg) // 1024} KB  {len(spec['lines'])} lines")

    truth_path.write_text(json.dumps(truth, indent=1, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
