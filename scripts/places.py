#!/usr/bin/env python3
"""places.py - offline place names from GPS (slideshow layer, R11). Used by build-vocabulary.py.

Data: GeoNames "cities1000" (every populated place with at least 1,000 people, about 150,000) and
"countryInfo.txt", fetched once onto the Pi by scripts/fetch-places.sh. GeoNames data is licensed
CC BY 4.0 (https://www.geonames.org); the README credits it. No lookup ever leaves the Pi.

For each photo position:
  locality = the nearest place within 15 km (for example "Vernazza" or "Newtown")
  city     = the most populous place within 25 km (for example "La Spezia" or "Sydney"), used to
             group places on the phone (country, then city); the locality when nothing is bigger
  country  = the locality's (or city's) country
Positions further than 25 km from any place get no place.
"""
import math
import os
import sys

LOCALITY_KM = 15.0
CITY_KM = 25.0
CELL = 0.5  # degrees; neighbouring cells cover 25 km up to about 63 degrees of latitude


def _km(lat1, lon1, lat2, lon2):
    x = math.radians(lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2))
    y = math.radians(lat2 - lat1)
    return 6371.0 * math.hypot(x, y)


class Places:
    """Nearest-place lookup over a GeoNames cities file. places[i] = (name, cc, lat, lon, population)."""

    def __init__(self, cities_path, countries_path=None):
        self.places = []
        self.grid = {}
        with open(cities_path, encoding="utf-8") as fh:
            for line in fh:
                c = line.rstrip("\n").split("\t")
                if len(c) < 15:
                    continue
                try:
                    lat, lon, pop = float(c[4]), float(c[5]), int(c[14] or 0)
                except ValueError:
                    continue
                i = len(self.places)
                self.places.append((c[1], c[8], lat, lon, pop))
                self.grid.setdefault((math.floor(lat / CELL), math.floor(lon / CELL)), []).append(i)
        self.countries = {}
        if countries_path and os.path.exists(countries_path):
            with open(countries_path, encoding="utf-8") as fh:
                for line in fh:
                    if line.startswith("#"):
                        continue
                    c = line.rstrip("\n").split("\t")
                    if len(c) > 4 and len(c[0]) == 2:
                        self.countries[c[0]] = c[4]
        self._cache = {}

    def country_name(self, cc):
        return self.countries.get(cc, cc)

    def lookup(self, lat, lon):
        """Returns (locality_index, city_index) or (None, None)."""
        key = (round(lat, 3), round(lon, 3))
        if key in self._cache:
            return self._cache[key]
        gy, gx = math.floor(lat / CELL), math.floor(lon / CELL)
        best = best_d = None
        city = city_pop = None
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for i in self.grid.get((gy + dy, gx + dx), ()):
                    _, _, plat, plon, pop = self.places[i]
                    d = _km(lat, lon, plat, plon)
                    if d <= CITY_KM:
                        if best_d is None or d < best_d:
                            best, best_d = i, d
                        if city_pop is None or pop > city_pop:
                            city, city_pop = i, pop
        if best is None:
            result = (None, None)
        else:
            result = (best if best_d <= LOCALITY_KM else None, city)
        self._cache[key] = result
        return result


if __name__ == "__main__":
    # places.py CITIES [COUNTRIES] LAT LON  - look one position up (for a quick check by hand)
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    args = sys.argv[1:]
    p = Places(args[0], args[1] if len(args) == 4 else None)
    loc, city = p.lookup(float(args[-2]), float(args[-1]))
    for label, i in (("locality", loc), ("city", city)):
        print(label, p.places[i][0] + ", " + p.country_name(p.places[i][1]) if i is not None else "-")
