"""Map 03 - Who is most vulnerable to drought?

Overlap of three ingredients, per country:
  (countries under 5,000 km2 are not rated: far smaller than one cell of the rainfall grid)
  D  drought frequency   share of 12-month periods in 1979-2010 with rainfall below 80 % of normal
                         (GPCP v2.2, 2.5 deg; cells with < 100 mm/yr are treated as permanently
                         arid and skipped; area-weighted mean of the remaining cells)
  P  population density  people per km2 of land (World Bank WDI, EN.POP.DNST)
  A  farm dependence     employment in agriculture, % of total (WDI, SL.AGR.EMPL.ZS, modelled ILO)

Each ingredient is turned into a percentile rank (0-1) among rated countries;
score = 100 * (rD * rP * rA) ** (1/3)   - a geometric mean, so a country has to be high on
all three at once to score high.

Outputs
  data/countries.geojson   Natural Earth 1:50m countries + indicators
  data/map03.json          rankings and metadata
"""
import csv
import json
import sys
import numpy as np
import netCDF4
from common import load_geojson, rasterize, round_coords, iso3, nice_name

RAW, OUT = sys.argv[1], sys.argv[2]
ARID_MM = 100          # hyper-arid cut-off (mm / yr)
TRIPLE = 0.6           # "triple overlap": upper 40 % on all three ingredients
DEFICIT = 0.8          # "drought" = 12-month rainfall below 80 % of normal
NX, NY = 720, 360      # 0.5 deg working grid

# ------------------------------------------------------------------ GPCP
g = netCDF4.Dataset(f"{RAW}/gpcp.nc")
P = g["PREC"][:].filled(np.nan)                       # [384, 72, 144] mm/day, S->N, 0..360E
days = np.tile([31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31], 32)
mm = np.nan_to_num(P * days[:, None, None])
mm = np.roll(mm[:, ::-1, :], 72, axis=2)              # N->S, -180..180
csum = np.cumsum(np.concatenate([np.zeros((1, 72, 144)), mm]), axis=0)
roll = csum[12:] - csum[:-12]                         # 373 overlapping 12-month totals
normal = roll.mean(0)
freq = (roll < DEFICIT * normal).mean(0) * 100        # % of 12-month periods in deficit
annual = mm.reshape(32, 12, 72, 144).sum(1)
cv = annual.std(0, ddof=1) / annual.mean(0) * 100
up = lambda a: np.repeat(np.repeat(a, 5, axis=0), 5, axis=1)     # 2.5 deg -> 0.5 deg
freq_hi, normal_hi, cv_hi = up(freq), up(normal), up(cv)
lat = 90 - (np.arange(NY) + 0.5) * 0.5
w = np.repeat(np.cos(np.radians(lat))[:, None], NX, axis=1)


# ------------------------------------------------------------------- WDI
def latest(ind, since=2015):
    best = {}
    with open(f"{RAW}/wdi_{ind}.csv", encoding="utf8") as f:
        for r in csv.DictReader(f):
            y = int(r["time"])
            if y >= since and r[ind] not in ("", None):
                if r["geo"] not in best or y > best[r["geo"]][0]:
                    best[r["geo"]] = (y, float(r[ind]))
    return best


dens, agemp, aggdp, pop, area = (latest(i) for i in ("en_pop_dnst", "sl_agr_empl_zs", "nv_agr_totl_zs", "sp_pop_totl", "ag_lnd_totl_k2"))
MIN_AREA = 5000        # km2 - smaller countries are far below the size of one 2.5 deg rainfall cell
WDI_CODE = {"KOS": "xkx", "XKX": "xkx"}

# --------------------------------------------------------------- countries
countries = load_geojson(f"{RAW}/ne_50m_admin_0_countries.geojson")
recs = []
for f in countries["features"]:
    p = f["properties"]
    code = iso3(p)
    m = rasterize(f["geometry"], NX, NY)
    if not m.any():                                    # tiny territory: use label point
        i = int(np.clip((90 - p["LABEL_Y"]) / 0.5, 0, NY - 1)); j = int(np.clip((p["LABEL_X"] + 180) / 0.5, 0, NX - 1))
        m = np.zeros((NY, NX), bool); m[i, j] = True
    rain = float((normal_hi * w)[m].sum() / w[m].sum())
    wet = m & (normal_hi >= ARID_MM)
    arid_share = 1 - w[wet].sum() / w[m].sum()
    rec = {"iso3": code, "name": nice_name(p), "continent": p["CONTINENT"],
           "lon": round(float(p["LABEL_X"]), 2), "lat": round(float(p["LABEL_Y"]), 2),
           "rain": round(rain), "arid_share": round(float(arid_share) * 100),
           "D": round(float((freq_hi * w)[wet].sum() / w[wet].sum()), 1) if wet.any() else None,
           "cv": round(float((cv_hi * w)[wet].sum() / w[wet].sum()), 1) if wet.any() else None}
    k = WDI_CODE.get(code, code.lower())
    for key, src, nd in (("P", dens, 1), ("A", agemp, 1), ("G", aggdp, 1), ("pop", pop, 0), ("area", area, 0)):
        if k in src:
            rec[key] = round(src[k][1], nd) if nd else int(src[k][1])
            rec[key + "_y"] = src[k][0]
        else:
            rec[key] = None
    rec["geom"] = f["geometry"]
    recs.append(rec)

# merge duplicates of the same ISO code (e.g. Australian external territories) -> keep data on all
small = lambda r: r["area"] is not None and r["area"] < MIN_AREA
rated = [r for r in recs if r["D"] is not None and r["P"] is not None and r["A"] is not None
         and r["iso3"] not in ("ATA",) and not small(r)]
seen = {}
for r in rated:
    seen.setdefault(r["iso3"], r)
uniq = list(seen.values())


def pct_rank(vals):
    v = np.array(vals, float)
    order = v.argsort().argsort().astype(float)
    # average rank for ties
    for x in np.unique(v):
        sel = v == x
        order[sel] = order[sel].mean()
    return (order + 0.5) / len(v)


for key in ("D", "P", "A"):
    for r, q in zip(uniq, pct_rank([r[key] for r in uniq])):
        r["r" + key] = round(float(q), 3)
for r in uniq:
    r["score"] = round(100 * (r["rD"] * r["rP"] * r["rA"]) ** (1 / 3), 1)
    r["triple"] = int(min(r["rD"], r["rP"], r["rA"]) >= TRIPLE)
by_code = {r["iso3"]: r for r in uniq}

feats = []
for n, r in enumerate(recs, 1):
    src = by_code.get(r["iso3"])
    props = {k: r[k] for k in ("iso3", "name", "continent", "rain", "arid_share", "D", "P", "A", "G", "pop")}
    for k in ("P_y", "A_y"):
        props[k] = r.get(k)
    if src is not None and r["iso3"] != "ATA":
        for k in ("rD", "rP", "rA", "score", "triple"):
            props[k] = src[k]
        props["status"] = "rated"
    elif small(r) and r["P"] is not None and r["A"] is not None:
        props["status"] = "small"         # too small for the rainfall grid
    else:
        props["status"] = "nodata"
    feats.append({"type": "Feature", "id": n, "properties": props,
                  "geometry": round_coords(r["geom"], 2)})

with open(f"{OUT}/countries.geojson", "w", encoding="utf8") as f:
    json.dump({"type": "FeatureCollection", "features": feats}, f, ensure_ascii=False, separators=(",", ":"))

top = sorted(uniq, key=lambda r: -r["score"])
keep = ("iso3", "name", "score", "D", "P", "A", "rD", "rP", "rA", "pop", "lon", "lat", "triple")
meta = {
    "n_rated": len(uniq), "arid_mm": ARID_MM, "deficit": DEFICIT,
    "top": [{k: r[k] for k in keep} for r in top[:25]],
    "min_area_km2": MIN_AREA, "triple_rank": TRIPLE,
    "triple": [r["name"] for r in top if r["triple"]],
    "pop_triple": int(sum(r["pop"] or 0 for r in top if r["triple"])),
    "pop_rated": int(sum(r["pop"] or 0 for r in uniq)),
    "small": sorted(r["name"] for r in recs if small(r) and r["P"] is not None and r["A"] is not None),
    "missing": sorted(r["name"] for r in recs if r["P"] is None or r["A"] is None),
    "pop_top20": int(sum(r["pop"] or 0 for r in top[:20])),
    "quantiles": {k: [round(float(np.percentile([r[k] for r in uniq], q)), 1) for q in (20, 40, 60, 80)]
                  for k in ("D", "P", "A", "score")},
}
with open(f"{OUT}/map03.json", "w", encoding="utf8") as f:
    json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))

print("rated", len(uniq), "| too small:", len(meta["small"]), "| missing:", len(meta["missing"]))
print("triple overlap:", meta["triple"], meta["pop_triple"] / 1e9, "of", meta["pop_rated"] / 1e9)
print("quantiles", meta["quantiles"])
for r in top[:25]:
    print(f"{r['name'][:28]:28s} score {r['score']:5.1f}  D {r['D']:5.1f} ({r['rD']:.2f})  P {r['P']:7.1f} ({r['rP']:.2f})  A {r['A']:5.1f} ({r['rA']:.2f})")
print("highest D:", [(r["name"], r["D"]) for r in sorted(uniq, key=lambda r: -r["D"])[:15]])
print("lowest D:", [(r["name"], r["D"]) for r in sorted(uniq, key=lambda r: r["D"])[:8]])
for c in ("IND", "ETH", "KEN", "NER", "AUS", "USA", "KAZ", "BRA", "CHN", "DZA", "SAU", "ZAF", "ESP", "DEU", "SOM", "AFG"):
    r = by_code.get(c)
    print(c, r and (r["score"], r["D"], r["P"], r["A"], r["rain"]))
