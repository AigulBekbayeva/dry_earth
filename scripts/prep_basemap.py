"""Shared base layers from Natural Earth 1:50m: land, ocean mask, large lakes."""
import json
import sys
from common import load_geojson, round_coords

RAW, OUT = sys.argv[1], sys.argv[2]


def slim(path, keep=lambda p: True, props=lambda p: {}):
    feats = []
    for f in load_geojson(path)["features"]:
        if not keep(f["properties"]):
            continue
        g = round_coords(f["geometry"], 2)
        if g:
            feats.append({"type": "Feature", "properties": props(f["properties"]), "geometry": g})
    return {"type": "FeatureCollection", "features": feats}


def clamp_south(fc, lat=-84.9):
    """Keep the ocean mask off the Web-Mercator edge (85.05 S): MapLibre's globe stretches
    anything touching that edge to the pole, which would paint a wedge of 'ocean' over Antarctica."""
    for f in fc["features"]:
        g = f["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        for poly in polys:
            for ring in poly:
                for pt in ring:
                    if pt[1] < lat:
                        pt[1] = lat
    return fc


out = {
    "land": slim(f"{RAW}/ne_50m_land.geojson"),
    "ocean": clamp_south(slim(f"{RAW}/ne_50m_ocean.geojson")),
    "lakes": slim(f"{RAW}/ne_50m_lakes.geojson", keep=lambda p: (p.get("scalerank") or 9) <= 1,
                  props=lambda p: {"name": p.get("name")}),
}
for k, v in out.items():
    with open(f"{OUT}/{k}.geojson", "w", encoding="utf8") as f:
        json.dump(v, f, ensure_ascii=False, separators=(",", ":"))
    print(k, len(v["features"]))
