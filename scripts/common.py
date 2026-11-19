"""Shared helpers for the data-prep scripts (numpy + Pillow only)."""
import json
import numpy as np
from PIL import Image, ImageDraw


def load_geojson(path):
    with open(path, encoding="utf8") as f:
        return json.load(f)


def polygons(geom):
    """Yield polygons (list of rings) from a Polygon / MultiPolygon geometry."""
    if geom is None:
        return
    if geom["type"] == "Polygon":
        yield geom["coordinates"]
    elif geom["type"] == "MultiPolygon":
        yield from geom["coordinates"]


def rasterize(geom, nx, ny):
    """Rasterise a lon/lat geometry onto a global equirectangular grid
    (row 0 = 90N, col 0 = 180W). Returns a boolean array [ny, nx]."""
    img = Image.new("L", (nx, ny), 0)
    d = ImageDraw.Draw(img)
    sx, sy = nx / 360.0, ny / 180.0
    for poly in polygons(geom):
        ext = [((x + 180) * sx, (90 - y) * sy) for x, y, *_ in poly[0]]
        if len(ext) >= 3:
            d.polygon(ext, fill=1)
        for hole in poly[1:]:
            h = [((x + 180) * sx, (90 - y) * sy) for x, y, *_ in hole]
            if len(h) >= 3:
                d.polygon(h, fill=0)
    return np.asarray(img, dtype=bool)


def cell_area_weights(ny, nx):
    """cos(latitude) weights for a global equirectangular grid."""
    lat = 90 - (np.arange(ny) + 0.5) * 180.0 / ny
    return np.repeat(np.cos(np.radians(lat))[:, None], nx, axis=1)


def round_coords(geom, nd=2):
    """Round coordinates and drop consecutive duplicates / degenerate rings."""
    def ring(r):
        out = []
        for x, y, *_ in r:
            p = [round(x, nd), round(y, nd)]
            if not out or out[-1] != p:
                out.append(p)
        if out and out[0] != out[-1]:
            out.append(out[0])
        return out if len(out) >= 4 else None

    polys = []
    for poly in polygons(geom):
        rings = [ring(r) for r in poly]
        if rings[0] is None:
            continue
        polys.append([r for r in rings if r])
    if not polys:
        return None
    if len(polys) == 1:
        return {"type": "Polygon", "coordinates": polys[0]}
    return {"type": "MultiPolygon", "coordinates": polys}


def iso3(props):
    """Best ISO3 code for a Natural Earth admin-0 feature."""
    for k in ("ISO_A3_EH", "ISO_A3", "ADM0_A3"):
        v = props.get(k)
        if v and v != "-99":
            return v
    return props.get("ADM0_A3")


_NAMES = {"Dem. Rep. Korea": "North Korea", "Republic of Korea": "South Korea",
          "Republic of Cabo Verde": "Cabo Verde", "Lao PDR": "Laos", "Russian Federation": "Russia",
          "Brunei Darussalam": "Brunei", "The Gambia": "Gambia", "Republic of the Congo": "Congo",
          "Kingdom of eSwatini": "Eswatini", "Czech Republic": "Czechia",
          "Democratic Republic of the Congo": "DR Congo", "Federated States of Micronesia": "Micronesia",
          "Falkland Islands / Malvinas": "Falkland Islands", "Macao": "Macau"}


def nice_name(props):
    n = props.get("NAME_LONG") or props.get("NAME")
    return _NAMES.get(n, n)
