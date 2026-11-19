"""Map 02 - Which regions are getting drier? (projection to ~2050)

Inputs
  raw/atlas/pr/*.csv, raw/atlas/tas/*.csv   IPCC WGI AR6 Atlas, CMIP6 monthly regional means (land only)
  raw/atlas/obs/OBS_pr_land_W5E5.csv        W5E5 observational reference
  raw/ar6.geojson                           IPCC WGI reference regions v4

Method
  For every CMIP6 model with both a historical and an SSP run:
    change = mean(2041-2060) vs mean(1995-2014)   (precipitation in %, temperature in deg C)
  Ensemble summary per region: median, 10th-90th percentile, share of models agreeing on the sign.

Outputs
  data/regions.geojson   46 land regions with change statistics for 4 scenarios
  data/map02.json        20-year running-mean trajectories (window centre 1970-2050) + rankings
"""
import csv
import glob
import json
import os
import re
import sys
import numpy as np
from common import load_geojson, round_coords

RAW, OUT = sys.argv[1], sys.argv[2]
SCEN = ["ssp126", "ssp245", "ssp370", "ssp585"]
DAYS = np.array([31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])
BASE, FUT = (1995, 2014), (2041, 2060)


def read(path):
    """-> (region names, {year: [12 x nregions] array})"""
    with open(path, encoding="utf8") as f:
        rows = [r for r in csv.reader(l for l in f if not l.startswith("#"))]
    hdr = rows[0][1:]
    by_year = {}
    for r in rows[1:]:
        y, m = int(r[0][:4]), int(r[0][5:7])
        vals = np.array([float(x) if x not in ("", "NA") else np.nan for x in r[1:]])
        by_year.setdefault(y, np.full((12, len(hdr)), np.nan))[m - 1] = vals
    return hdr, by_year


def annual(by_year, how):
    """Annual value per region: precipitation total (mm) or mean temperature."""
    out = {}
    for y, a in by_year.items():
        if np.isnan(a).all(axis=1).any():
            continue                                   # incomplete year
        if how == "pr":
            out[y] = (a * DAYS[:, None]).sum(0)        # mm / year
        else:
            out[y] = (a * DAYS[:, None]).sum(0) / DAYS.sum()
    return out


def models(var, scen):
    res = {}
    for p in sorted(glob.glob(f"{RAW}/atlas/{var}/CMIP6_*_{scen}_*.csv")):
        m = re.match(r"CMIP6_(.+)_" + scen + r"_(.+)\.csv", os.path.basename(p))
        res[m.group(1)] = p
    return res


hist = {v: models(v, "historical") for v in ("pr", "tas")}
names = None
ann = {}        # (var, scen, model) -> {year: array}
for var in ("pr", "tas"):
    for model, p in hist[var].items():
        names, by = read(p)
        ann[(var, "historical", model)] = annual(by, var)
    for s in SCEN:
        for model, p in models(var, s).items():
            if model not in hist[var]:
                continue
            _, by = read(p)
            ann[(var, s, model)] = annual(by, var)

NAMES = {
    "GIC": "Greenland and Iceland", "NWN": "North-western North America", "NEN": "North-eastern North America",
    "WNA": "Western North America", "CNA": "Central North America", "ENA": "Eastern North America",
    "NCA": "Northern Central America", "SCA": "Southern Central America", "CAR": "Caribbean",
    "NWS": "North-western South America", "NSA": "Northern South America", "NES": "North-eastern South America",
    "SAM": "South American Monsoon region", "SWS": "South-western South America",
    "SES": "South-eastern South America", "SSA": "Southern South America", "NEU": "Northern Europe",
    "WCE": "Western and Central Europe", "EEU": "Eastern Europe", "MED": "Mediterranean", "SAH": "Sahara",
    "WAF": "Western Africa", "CAF": "Central Africa", "NEAF": "North-eastern Africa",
    "SEAF": "South-eastern Africa", "WSAF": "West Southern Africa", "ESAF": "East Southern Africa",
    "MDG": "Madagascar", "RAR": "Russian Arctic", "WSB": "West Siberia", "ESB": "East Siberia",
    "RFE": "Russian Far East", "WCA": "West Central Asia", "ECA": "East Central Asia", "TIB": "Tibetan Plateau",
    "EAS": "East Asia", "ARP": "Arabian Peninsula", "SAS": "South Asia", "SEA": "South-East Asia",
    "NAU": "Northern Australia", "CAU": "Central Australia", "EAU": "Eastern Australia",
    "SAU": "Southern Australia", "NZ": "New Zealand", "EAN": "East Antarctica", "WAN": "West Antarctica",
}

land = [f for f in load_geojson(f"{RAW}/ar6.geojson")["features"]
        if f["properties"]["Type"] in ("Land", "Land-Ocean")]
acr = [f["properties"]["Acronym"] for f in land]
idx = [names.index(a) for a in acr]


def mean_period(series, a, b):
    ys = [series[y] for y in range(a, b + 1) if y in series]
    return np.mean(ys, axis=0) if len(ys) >= (b - a + 1) * 0.9 else None


summary = {a: {} for a in acr}
traj = {a: {} for a in acr}
CENTRES = list(range(1970, 2051))           # centre year c -> window c-9 .. c+10
n_models = {}
for s in SCEN:
    d_pr, d_tas, tr = [], [], []
    for model in sorted(hist["pr"]):
        if ("pr", s, model) not in ann:
            continue
        full = dict(ann[("pr", "historical", model)])
        full.update(ann[("pr", s, model)])
        b, f = mean_period(full, *BASE), mean_period(full, *FUT)
        if b is None or f is None:
            continue
        d_pr.append((f - b) / b * 100)
        row = []
        for c in CENTRES:
            w = mean_period(full, c - 9, c + 10)
            row.append((w - b) / b * 100 if w is not None else np.full(len(names), np.nan))
        tr.append(row)
    for model in sorted(hist["tas"]):
        if ("tas", s, model) not in ann:
            continue
        full = dict(ann[("tas", "historical", model)])
        full.update(ann[("tas", s, model)])
        b, f = mean_period(full, *BASE), mean_period(full, *FUT)
        if b is not None and f is not None:
            d_tas.append(f - b)
    d_pr, d_tas, tr = np.array(d_pr), np.array(d_tas), np.array(tr)   # tr: [model, year, region]
    n_models[s] = {"pr": int(d_pr.shape[0]), "tas": int(d_tas.shape[0])}
    for a, i in zip(acr, idx):
        x = d_pr[:, i]
        med = float(np.median(x))
        agree = float(np.mean(np.sign(x) == np.sign(med)) * 100)
        summary[a][s] = {
            "pr": round(med, 1), "p10": round(float(np.percentile(x, 10)), 1),
            "p90": round(float(np.percentile(x, 90)), 1), "agree": round(agree),
            "dry_models": round(float(np.mean(x < 0) * 100)),
            "tas": round(float(np.median(d_tas[:, i])), 1), "n": int(len(x)),
        }
        t = tr[:, :, i]
        traj[a][s] = {
            "med": [round(float(v), 1) for v in np.nanmedian(t, axis=0)],
            "p10": [round(float(v), 1) for v in np.nanpercentile(t, 10, axis=0)],
            "p90": [round(float(v), 1) for v in np.nanpercentile(t, 90, axis=0)],
        }

# observed baseline (W5E5, 1995-2014)
hdr, by = read(f"{RAW}/atlas/obs/OBS_pr_land_W5E5.csv")
obs = mean_period(annual(by, "pr"), *BASE)
obs_years = sorted(annual(by, "pr"))

feats = []
for f in land:
    p = f["properties"]
    a = p["Acronym"]
    ring = max(([r[0] for r in ([f["geometry"]["coordinates"]] if f["geometry"]["type"] == "Polygon"
                                else f["geometry"]["coordinates"])]), key=len)
    xs, ys = [c[0] for c in ring], [c[1] for c in ring]
    cx, cy = (min(xs) + max(xs)) / 2, max((min(ys) + max(ys)) / 2, -78)
    if max(xs) - min(xs) > 300:            # circumpolar region
        cx = 60 if a == "EAN" else cx
    props = {"id": a, "name": NAMES[a], "ipcc_name": p["Name"], "lon": round(cx, 1), "lat": round(cy, 1), "continent": p["Continent"].title().replace("-", " "),
             "obs_mm": round(float(obs[hdr.index(a)]))}
    for s in SCEN:
        for k, val in summary[a][s].items():
            props[f"{s}_{k}"] = val
    feats.append({"type": "Feature", "id": len(feats) + 1, "properties": props,
                  "geometry": round_coords(f["geometry"], 2)})

with open(f"{OUT}/regions.geojson", "w", encoding="utf8") as f:
    json.dump({"type": "FeatureCollection", "features": feats}, f, ensure_ascii=False, separators=(",", ":"))
with open(f"{OUT}/map02.json", "w", encoding="utf8") as f:
    json.dump({"centres": CENTRES, "baseline": BASE, "future": FUT, "n_models": n_models,
               "obs_period": [obs_years[0], obs_years[-1]], "traj": traj},
              f, separators=(",", ":"))

print("models", n_models, "obs years", obs_years[0], obs_years[-1])
for s in ("ssp245", "ssp585"):
    rank = sorted(feats, key=lambda x: x["properties"][f"{s}_pr"])
    print(s, "driest:", [(x["properties"]["id"], x["properties"][f"{s}_pr"], x["properties"][f"{s}_agree"]) for x in rank[:10]])
    print(s, "wettest:", [(x["properties"]["id"], x["properties"][f"{s}_pr"]) for x in rank[-5:]])
    print(s, "n drying:", sum(x["properties"][f"{s}_pr"] < 0 for x in feats),
          "robust drying:", sum(x["properties"][f"{s}_pr"] < 0 and x["properties"][f"{s}_agree"] >= 80 for x in feats))
print({a: feats[acr.index(a)]["properties"]["obs_mm"] for a in ("SAH", "MED", "WCA", "NSA", "SEA", "ARP")})
