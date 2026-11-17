from colorsys import hsv_to_rgb

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SIDE_SIZE = 448


def smooth(low, high, value):
    weight = np.clip((value - low) / (high - low), 0, 1)
    return weight * weight * (3 - 2 * weight)


def shader(image, palette):
    rgb = np.asarray(image, dtype=np.float32) / 255
    red, green, blue = rgb.transpose((2, 0, 1))
    select = green >= blue
    qx, qy = np.maximum(blue, green), np.minimum(blue, green)
    qz, qw = np.where(select, 0, -1.), np.where(select, -1 / 3, 2 / 3)
    select = red >= qx
    val, rw = np.maximum(red, qx), np.minimum(red, qx)
    chroma_delta = val - np.minimum(rw, qy)
    hue = np.abs(np.where(select, qz, qw) + (rw - qy) / (6 * chroma_delta + 1e-5))
    sat = chroma_delta / (val + 1e-5)
    chroma = smooth(.12, .25, sat)
    new_h, new_s, new_v = hue.copy(), sat.copy(), val.copy()
    for swap in palette["swaps"]:
        start, target = np.array(swap[:2]) / 360
        width = (swap[2] if len(swap) > 2 else 40) / 360
        scale = swap[3] if len(swap) > 3 else 1
        offset = np.abs((hue - start + .5) % 1 - .5)
        weight = chroma * (1 - smooth(width * .6, width, offset))
        new_h += weight * (((target + hue - start) % 1) - new_h)
        new_s += weight * (np.minimum(sat * scale, 1) - new_s)
    if grey := palette.get("grey"):
        weight = 1 - chroma
        new_h += weight * (grey["hue"] / 360 - new_h)
        new_s += weight * (np.maximum(new_s, grey["amount"]) - new_s)
        new_v *= 1 + weight * (grey.get("value", 1) - 1)
    channels = [
        new_v * (1 + new_s * (np.clip(abs((new_h + offset) % 1 * 6 - 3) - 1, 0, 1) - 1))
        for offset in (1, 2 / 3, 1 / 3)
    ]
    return np.stack(channels, -1), hue * 360, sat


def image_rgb(rgb):
    return Image.fromarray(np.rint(255 * np.clip(rgb, 0, 1)).astype("uint8"))


def uv_mask(xyz, texcoords, size, points):
    projected = xyz[:, :, [0, 2]]
    low, high = projected.min(axis=(0, 1)), projected.max(axis=(0, 1))
    scale = SIDE_SIZE / (1.12 * max(high - low))
    side = SIDE_SIZE / 2 + (projected - (high + low) * .5) * scale * [1, -1]
    side_mask = Image.new("L", (SIDE_SIZE, SIDE_SIZE))
    ImageDraw.Draw(side_mask).polygon([tuple(point) for point in points], fill=255)
    side_mask = np.asarray(side_mask)
    uv = (texcoords * [1, -1] + [0, 1]) * size - .5
    mask = np.zeros(size[::-1], dtype=np.uint8)
    for tri, pos in zip(uv, side):
        low = np.maximum(0, np.ceil(tri.min(0)).astype(int))
        high = np.minimum(np.array(size) - 1, np.floor(tri.max(0)).astype(int))
        if np.any(low > high):
            continue
        xx, yy = np.meshgrid(np.arange(low[0], high[0] + 1), np.arange(low[1], high[1] + 1))
        matrix = (tri[1:] - tri[0]).T
        if abs(np.linalg.det(matrix)) < 1e-9:
            continue
        bary = (np.stack((xx, yy), -1) - tri[0]) @ np.linalg.inv(matrix).T
        inside = (bary.min(-1) >= 0) & (bary.sum(-1) <= 1)
        screen = np.clip(
            np.floor(pos[0] + bary @ (pos[1:] - pos[0])).astype(int), 0, SIDE_SIZE - 1,
        )
        mask[yy[inside], xx[inside]] |= side_mask[screen[:, :, 1][inside], screen[:, :, 0][inside]]
    coverage = Image.new("1", size)
    draw = ImageDraw.Draw(coverage)
    for tri in uv:
        draw.polygon([tuple(point) for point in tri], fill=1)
    mask = Image.fromarray(mask)
    return Image.composite(mask, mask.filter(ImageFilter.MaxFilter(7)), coverage)


def blend(original, target, weight):
    return original + (target - original) * weight[:, :, None]


def region_mask(image, geometry, shapes):
    combined = np.zeros(image.size[::-1], dtype=np.uint8)
    for points in shapes:
        if geometry is None:
            mask = Image.new("L", image.size)
            ImageDraw.Draw(mask).polygon([tuple(point) for point in points], fill=255)
        else:
            mask = uv_mask(*geometry, image.size, points)
        np.maximum(combined, mask, out=combined)
    return combined


def ellipse(cx, cy, rx, ry):
    return [(cx + rx * np.cos(t), cy + ry * np.sin(t)) for t in np.linspace(0, 2*np.pi, 33)[:-1]]


def bake_region(form, image, recipe, palette, geometry=None):
    portrait = geometry is None
    surface = "portrait" if portrait else "model"
    base = np.asarray(image) / 255
    value = base.max(2)
    # Only these three regions build on the runtime hue swaps.
    if form == "dragonair":
        palette = {"swaps": palette["swaps"][:1]}
    elif form not in ("haunter", "dragonite"):
        palette = {"swaps": []}
    shifted, hue, sat = shader(image, palette)

    def tone(region):
        sample = recipe["tones"][region]
        h, s, v = sample["targetHSV"]
        source = sample[surface + "Value"]
        scale = v / source
        intensity = np.minimum(1, value * scale) if region == "beads" else np.minimum(1, value * v / source)
        if form == "gastly" and region == "core":
            intensity = np.where(value > source, np.minimum(1, v + (value - source) * .45), intensity)
        return intensity[:, :, None] * hsv_to_rgb(h / 360, s, 1)

    if form == "alakazam":
        armor = (1 - smooth(34, 44, hue)) * smooth(.05, .15, sat) * (1 - smooth(.57, .75, value))
        result = blend(base, tone("armor"), armor)
    elif form == "dragonite":
        skin = smooth(.32, .52, sat) * (1 - smooth(36, 42, hue)) * smooth(7, 20, hue)
        result = blend(shifted, tone("skin"), skin)
    elif form == "gastly":
        purple = smooth(234, 265, hue) * (1 - smooth(331, 351, hue)) * smooth(.035, .12, sat)
        mask = np.maximum(purple, (1 - smooth(.09, .18, sat)) * (1 - smooth(.31, .44, value)))
        mask *= 1 - smooth(.64, .79, value) * (1 - smooth(.20, .36, sat))
        if portrait:
            mask *= smooth(.12, .20, value)
        result = blend(base, blend(tone("core"), tone("fog"), smooth(.32, .50, value)), mask)
    elif form == "haunter":
        mouth = (1 - smooth(14, 32, np.minimum(hue, 360 - hue))) * smooth(.10, .25, sat)
        result = blend(shifted, tone("mouth"), mouth)
    elif form == "dragonair":
        shapes = [ellipse(*oval) for oval in recipe["beads"][surface]]
        beads = region_mask(image, geometry, shapes) / 255
        beads = beads * smooth(.16, .36, sat) * smooth(206, 217, hue) * (1 - smooth(255, 274, hue))
        if portrait:
            beads *= smooth(.13, .24, value)
        result = blend(shifted, tone("beads"), beads)
    elif form in ("geodude", "graveler"):
        rock = (1 - smooth(.25, .44, sat)) * (1 - (1 - smooth(.02, .09, sat)) * smooth(.54, .72, value))
        if portrait:
            rock *= smooth(.18, .36, value)
        result = image_rgb(blend(base, tone("rock"), rock))
        eyes = region_mask(image, geometry, recipe["eyes"][surface])
        if not portrait:
            # The side projection crosses the far surface too. Keep only neutral eye texels.
            chroma = (value - base.min(2)) / (value + 1e-5)
            eyes = np.rint(eyes * (1 - smooth(.045, .105, chroma))).astype("uint8")
        return Image.composite(image, result, Image.fromarray(eyes))
    elif form == "golem":
        _, hue_filtered, _ = shader(image.filter(ImageFilter.MedianFilter(5)), {"swaps": []})
        shell = smooth(26, 42, hue_filtered) * (1 - smooth(250, 288, hue_filtered))
        rock = (1 - smooth(.28, .46, sat)) * (1 - (1 - smooth(.05, .12, sat)) * smooth(.60, .81, value))
        if portrait:
            rock *= smooth(.18, .36, value)
        result = blend(base, blend(tone("limbs"), tone("rock"), shell), rock)
    else:
        raise ValueError(f"{form}: no region bake defined")
    return image_rgb(result)
