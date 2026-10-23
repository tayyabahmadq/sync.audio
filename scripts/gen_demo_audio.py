#!/usr/bin/env python3
"""
Sync.audio demo asset generator.
Creates two broadcast-ready demo tracks (48kHz mono WAV):
  1. action.wav      — cinematic action-trailer cue (kick/bass/lead/impacts)
  2. commentary.wav  — stadium-crowd bed + lo-fi beat (voice overlay added separately if TTS available)
Also renders PWA icons.
"""
import numpy as np
import wave, os

SR = 48000
OUT = "/home/z/my-project/public/demo"
ICONS = "/home/z/my-project/public/icons"
os.makedirs(OUT, exist_ok=True)
os.makedirs(ICONS, exist_ok=True)

rng = np.random.default_rng(7)

def save(name, x, peak=0.92):
    x = np.asarray(x, dtype=np.float64)
    m = np.max(np.abs(x)) or 1.0
    x = np.tanh(x / m * 1.15) * peak          # gentle glue/soft-clip
    pcm = (x * 32767).astype(np.int16)
    with wave.open(f"{OUT}/{name}", "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f"wrote {name}: {len(x)/SR:.1f}s")

def t_axis(dur): return np.arange(int(dur * SR)) / SR

def env_exp(n, tau): return np.exp(-np.arange(n) / (tau * SR))

def place(buf, x, at):
    i = int(at * SR)
    j = min(len(buf), i + len(x))
    if i < len(buf): buf[i:j] += x[: j - i]

def saw(f, dur, detune=0.0, roll=1.4, nh=24):
    t = t_axis(dur); out = np.zeros_like(t)
    f2 = f * (2 ** (detune / 1200))
    for k in range(1, nh + 1):
        fk, fk2 = f * k, f2 * k
        if fk > SR / 2.2 or fk2 > SR / 2.2: break
        out += (np.sin(2 * np.pi * fk * t) + np.sin(2 * np.pi * fk2 * t)) / (k ** roll)
    return out / (np.max(np.abs(out)) or 1)

def kick(amp=1.0):
    dur = 0.30; t = t_axis(dur)
    f = 150 * np.exp(-t * 22) + 44
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * env_exp(len(t), 0.09)
    click = (rng.standard_normal(int(0.004 * SR))) * env_exp(int(0.004 * SR), 0.0015) * 0.5
    out = body.copy(); out[: len(click)] += click
    return out * amp

def hat(open_=False, amp=0.5):
    dur = 0.14 if open_ else 0.045
    n = rng.standard_normal(int(dur * SR))
    n = np.diff(n, prepend=0); n = np.diff(n, prepend=0)   # crude HP
    n /= (np.max(np.abs(n)) or 1)
    return n * env_exp(len(n), 0.06 if open_ else 0.014) * amp

def snare(amp=0.9):
    dur = 0.22; ts = t_axis(dur); n = rng.standard_normal(int(dur * SR))
    dn = np.diff(n, prepend=0)
    dn /= (np.max(np.abs(dn)) or 1)
    body = np.sin(2 * np.pi * 190 * ts) * env_exp(len(ts), 0.05)
    return (dn * env_exp(len(dn), 0.06) * 0.8 + body * 0.4) * amp

def impact(amp=1.0):
    dur = 1.6; t = t_axis(dur)
    f = 55 * np.exp(-t * 3) + 34
    ph = 2 * np.pi * np.cumsum(f) / SR
    boom = np.sin(ph) * env_exp(len(t), 0.45)
    burst = rng.standard_normal(int(0.05 * SR)) * env_exp(int(0.05 * SR), 0.01) * 0.4
    out = boom.copy(); out[: len(burst)] += burst
    return out * amp

def riser(dur=7.5, amp=0.9):
    t = t_axis(dur)
    prog = (t / dur) ** 2
    f = 180 + prog * 1400
    ph = 2 * np.pi * np.cumsum(f) / SR
    tone = np.sin(ph) * 0.35
    n = rng.standard_normal(len(t))
    n = np.convolve(n, np.ones(24) / 24, mode="same")          # soften
    noise = n * (0.25 + prog * 0.75) * 0.9
    envl = prog * (1 - 0.12 * np.sin(2 * np.pi * 8 * t))        # tremolo shimmer
    return (tone + noise) * envl * amp

# ------------------------------------------------------------------ ACTION
def build_action():
    B = 0.5                      # 120 BPM
    dur = 64
    buf = np.zeros(dur * SR)
    A, C, E, G, F = 55.0, 65.41, 82.41, 98.0, 87.31   # A1 C2 E2 G2 F2
    chords = {"Am": [110.0, 130.81, 164.81], "F": [87.31, 130.81, 174.61],
              "C": [65.41, 130.81, 164.81], "G": [98.0, 146.83, 196.0]}

    # 0-8s intro: drone + pulse + riser
    place(buf, saw(55, 8.5, roll=2.2, nh=10) * 0.5, 0)
    for i in range(8):
        place(buf, kick(0.55), i * B * 2)
    place(buf, riser(7.5, 0.85), 0.5)

    # 8-24s section A
    bass_pat = [55, 55, 55, 49, 55, 55, 65.4, 49]
    for b in range(32):
        at = 8 + b * B
        place(buf, kick(0.95), at)
        if b % 4 == 2: place(buf, snare(0.5), at)
        place(buf, hat(amp=0.4), at + B / 2)
        if b % 4 == 3: place(buf, hat(open_=True, amp=0.35), at + B / 2)
        f = bass_pat[b % 8]
        x = saw(f, 0.42, roll=1.6, nh=14) * env_exp(int(0.42 * SR), 0.2) * 0.85
        place(buf, x, at + B * 0.5)
    for i, ch in enumerate(["Am", "Am", "F", "G"] * 2):
        for f in chords[ch]:
            place(buf, saw(f, 1.8, detune=9, roll=1.1, nh=16) * 0.16, 8 + i * 2)

    # 24-32s breakdown: pads + ticks
    prog = ["Am", "F", "C", "G"]
    for i, ch in enumerate(prog * 2):
        at = 24 + i * 2
        for f in chords[ch]:
            x = saw(f * 2, 2.1, detune=7, roll=1.2, nh=14)
            ea = np.minimum(t_axis(2.1) / 0.7, 1) * env_exp(len(x), 1.6)
            place(buf, x * ea * 0.22, at)
        place(buf, hat(amp=0.22), at + 1.0)
    place(buf, riser(6.5, 0.7), 25.5)

    # 32-48s drop
    lead_notes = [220, 220, 261.63, 293.66, 220, 329.63, 293.66, 261.63]
    for b in range(32):
        at = 32 + b * B
        place(buf, kick(1.0), at)
        if b % 4 == 2: place(buf, snare(0.75), at)
        place(buf, hat(amp=0.5), at + B / 2)
        f = bass_pat[b % 8]
        place(buf, saw(f, 0.4, roll=1.5, nh=16) * env_exp(int(0.4 * SR), 0.18) * 0.95, at)
        if b % 2 == 0:
            f2 = lead_notes[(b // 2) % 8]
            x = saw(f2, 0.85, detune=8, roll=1.15, nh=18) * env_exp(int(0.85 * SR), 0.5) * 0.34
            place(buf, x, at)
    for i, ch in enumerate(["Am", "F", "C", "G"] * 2):
        for f in chords[ch]:
            place(buf, saw(f * 2, 1.9, detune=10, roll=1.3, nh=12) * 0.12, 32 + i * 2)

    # 48-56s bridge: halftime + snare roll
    for b in range(16):
        at = 48 + b * B
        if b % 4 == 0: place(buf, kick(0.8), at)
        if b % 8 == 4: place(buf, snare(0.6), at)
        place(buf, hat(amp=0.3), at + B / 2)
    for k in range(16):                       # accelerating roll 52-56s
        at = 52 + (k / 16) ** 1.6 * 4
        place(buf, snare(0.25 + (at - 52) / 4 * 0.7), at)
    place(buf, riser(4, 0.9), 52)

    # 56-64s finale: impacts + tail
    place(buf, impact(1.1), 56)
    place(buf, impact(0.95), 60)
    for i, ch in enumerate(["Am", "Am"]):
        for f in chords[ch]:
            x = saw(f, 7.5, detune=12, roll=1.1, nh=14)
            ea = np.minimum(t_axis(7.5) / 1.2, 1) * env_exp(len(x), 2.8)
            place(buf, x * ea * 0.3, 56 + i * 2)
    tail = np.zeros(3 * SR)
    tail += saw(110, 3, roll=1.2, nh=10) * env_exp(3 * SR, 1.4) * 0.2
    place(buf, tail, 61)
    save("action.wav", buf[: dur * SR])

# -------------------------------------------------------------- COMMENTARY
def build_commentary():
    B = 60 / 96                 # 96 BPM lo-fi
    dur = 64
    buf = np.zeros(dur * SR)

    # crowd bed: shaped noise with slow swells
    n = len(buf)
    white = rng.standard_normal(n)
    brown = np.cumsum(white); brown -= np.linspace(brown[0], brown[-1], n)
    brown /= (np.max(np.abs(brown)) or 1)
    t = t_axis(dur)
    swell = 0.55 + 0.28 * np.sin(2 * np.pi * t / 13.0) + 0.17 * np.sin(2 * np.pi * t / 4.7 + 1.3)
    crowd = brown * swell * 0.32
    # cheer bursts
    for at in [5.2, 14.8, 23.5, 31.0, 38.7, 47.2, 55.6, 61.0]:
        d = 1.6; x = rng.standard_normal(int(d * SR))
        x = np.convolve(x, np.ones(48) / 48, mode="same")
        e = env_exp(len(x), 0.5) * np.minimum(t_axis(d) / 0.25, 1)
        place(buf, x * e * 0.55, at)

    # lo-fi beat 96bpm
    Dm7 = [146.83, 174.61, 220.0, 261.63]; Bb = [116.54, 174.61, 220.0, 293.66]
    prog = [Dm7, Bb, Dm7, Bb]
    for b in range(int(dur / (B * 4))):
        bar_at = b * B * 4
        ch = prog[b % 4]
        place(buf, kick(0.6) * 0.9, bar_at)
        place(buf, kick(0.45) * 0.8, bar_at + B * 2.5)
        place(buf, snare(0.28), bar_at + B)
        place(buf, snare(0.28), bar_at + B * 3)
        for i in range(8):
            place(buf, hat(amp=0.16 + 0.05 * (i % 2)), bar_at + i * B / 2)
        for k, f in enumerate(ch):
            x = saw(f / 2, B * 4 * 0.96, detune=6, roll=1.5, nh=12)
            ea = np.minimum(t_axis(len(x) / SR) / 0.4, 1) * env_exp(len(x), 2.2)
            place(buf, x * ea * (0.2 - 0.03 * k), bar_at)
        sub = saw(ch[0] / 4, B * 2, roll=2.0, nh=6) * env_exp(int(B * 2 * SR), 0.8) * 0.5
        place(buf, sub, bar_at)
    # vinyl crackle
    crack = np.zeros(n)
    idx = rng.integers(0, n - 200, size=260)
    for i in idx:
        crack[i:i + 120] += rng.standard_normal(120) * env_exp(120, 0.001) * 0.25
    buf += crack
    save("commentary.wav", buf)

build_action()
build_commentary()

# ------------------------------------------------------------------ icons
try:
    from PIL import Image, ImageDraw
    def icon(size, path):
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        # dark rounded square w/ emerald->fuchsia vertical gradient
        grad = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        gd = ImageDraw.Draw(grad)
        for y in range(size):
            r = int(8 + (18 - 8) * y / size)      # near-black to deep
            g = int(16 + 185 * y / size)
            b = int(22 + 120 * y / size)
            gd.line([(0, y), (size, y)], fill=(r, min(g, 255), min(b, 255), 255))
        mask = Image.new("L", (size, size), 0)
        md = ImageDraw.Draw(mask)
        rad = int(size * 0.22)
        md.rounded_rectangle([0, 0, size, size], radius=rad, fill=255)
        img.paste(grad, (0, 0), mask)
        # three sound arcs (white) = silent-broadcast glyph
        cx, cy = size * 0.5, size * 0.52
        w = max(2, int(size * 0.055))
        for k, r in enumerate([0.14, 0.27, 0.40]):
            rw = r * size
            bbox = [cx - rw, cy - rw, cx + rw, cy + rw]
            alpha = 255 - k * 55
            d.arc(bbox, start=-58, end=58, fill=(255, 255, 255, alpha), width=w)
        d.ellipse([cx - w * 1.3, cy - w * 1.3, cx + w * 1.3, cy + w * 1.3], fill=(255, 255, 255, 255))
        img.save(path)
        print("icon", path)
    icon(512, f"{ICONS}/icon-512.png")
    icon(192, f"{ICONS}/icon-192.png")
    icon(180, f"{ICONS}/apple-touch-icon.png")
    icon(64, f"{ICONS}/icon-64.png")
except Exception as e:
    print("icon generation skipped:", e)
