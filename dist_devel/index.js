import path from 'path';
      import { fileURLToPath } from 'url';
      import { createRequire as topLevelCreateRequire } from 'module';
      const require = topLevelCreateRequire(import.meta.url);
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../node_modules/moment-timezone/builds/moment-timezone-with-data-10-year-range.js
var require_moment_timezone_with_data_10_year_range = __commonJS({
  "../../node_modules/moment-timezone/builds/moment-timezone-with-data-10-year-range.js"(exports, module) {
    (function(root, factory) {
      "use strict";
      if (typeof module === "object" && module.exports) {
        module.exports = factory(__require("moment"));
      } else if (typeof define === "function" && define.amd) {
        define(["moment"], factory);
      } else {
        factory(root.moment);
      }
    })(exports, function(moment4) {
      "use strict";
      if (moment4.version === void 0 && moment4.default) {
        moment4 = moment4.default;
      }
      var VERSION = "0.5.47", zones = {}, links = {}, countries = {}, names = {}, guesses = {}, cachedGuess;
      if (!moment4 || typeof moment4.version !== "string") {
        logError("Moment Timezone requires Moment.js. See https://momentjs.com/timezone/docs/#/use-it/browser/");
      }
      var momentVersion = moment4.version.split("."), major = +momentVersion[0], minor = +momentVersion[1];
      if (major < 2 || major === 2 && minor < 6) {
        logError("Moment Timezone requires Moment.js >= 2.6.0. You are using Moment.js " + moment4.version + ". See momentjs.com");
      }
      function charCodeToInt(charCode) {
        if (charCode > 96) {
          return charCode - 87;
        } else if (charCode > 64) {
          return charCode - 29;
        }
        return charCode - 48;
      }
      function unpackBase60(string) {
        var i = 0, parts = string.split("."), whole = parts[0], fractional = parts[1] || "", multiplier = 1, num, out = 0, sign = 1;
        if (string.charCodeAt(0) === 45) {
          i = 1;
          sign = -1;
        }
        for (i; i < whole.length; i++) {
          num = charCodeToInt(whole.charCodeAt(i));
          out = 60 * out + num;
        }
        for (i = 0; i < fractional.length; i++) {
          multiplier = multiplier / 60;
          num = charCodeToInt(fractional.charCodeAt(i));
          out += num * multiplier;
        }
        return out * sign;
      }
      function arrayToInt(array) {
        for (var i = 0; i < array.length; i++) {
          array[i] = unpackBase60(array[i]);
        }
      }
      function intToUntil(array, length) {
        for (var i = 0; i < length; i++) {
          array[i] = Math.round((array[i - 1] || 0) + array[i] * 6e4);
        }
        array[length - 1] = Infinity;
      }
      function mapIndices(source, indices) {
        var out = [], i;
        for (i = 0; i < indices.length; i++) {
          out[i] = source[indices[i]];
        }
        return out;
      }
      function unpack(string) {
        var data = string.split("|"), offsets = data[2].split(" "), indices = data[3].split(""), untils = data[4].split(" ");
        arrayToInt(offsets);
        arrayToInt(indices);
        arrayToInt(untils);
        intToUntil(untils, indices.length);
        return {
          name: data[0],
          abbrs: mapIndices(data[1].split(" "), indices),
          offsets: mapIndices(offsets, indices),
          untils,
          population: data[5] | 0
        };
      }
      function Zone(packedString) {
        if (packedString) {
          this._set(unpack(packedString));
        }
      }
      function closest(num, arr) {
        var len = arr.length;
        if (num < arr[0]) {
          return 0;
        } else if (len > 1 && arr[len - 1] === Infinity && num >= arr[len - 2]) {
          return len - 1;
        } else if (num >= arr[len - 1]) {
          return -1;
        }
        var mid;
        var lo = 0;
        var hi = len - 1;
        while (hi - lo > 1) {
          mid = Math.floor((lo + hi) / 2);
          if (arr[mid] <= num) {
            lo = mid;
          } else {
            hi = mid;
          }
        }
        return hi;
      }
      Zone.prototype = {
        _set: function(unpacked) {
          this.name = unpacked.name;
          this.abbrs = unpacked.abbrs;
          this.untils = unpacked.untils;
          this.offsets = unpacked.offsets;
          this.population = unpacked.population;
        },
        _index: function(timestamp) {
          var target = +timestamp, untils = this.untils, i;
          i = closest(target, untils);
          if (i >= 0) {
            return i;
          }
        },
        countries: function() {
          var zone_name = this.name;
          return Object.keys(countries).filter(function(country_code) {
            return countries[country_code].zones.indexOf(zone_name) !== -1;
          });
        },
        parse: function(timestamp) {
          var target = +timestamp, offsets = this.offsets, untils = this.untils, max = untils.length - 1, offset, offsetNext, offsetPrev, i;
          for (i = 0; i < max; i++) {
            offset = offsets[i];
            offsetNext = offsets[i + 1];
            offsetPrev = offsets[i ? i - 1 : i];
            if (offset < offsetNext && tz.moveAmbiguousForward) {
              offset = offsetNext;
            } else if (offset > offsetPrev && tz.moveInvalidForward) {
              offset = offsetPrev;
            }
            if (target < untils[i] - offset * 6e4) {
              return offsets[i];
            }
          }
          return offsets[max];
        },
        abbr: function(mom) {
          return this.abbrs[this._index(mom)];
        },
        offset: function(mom) {
          logError("zone.offset has been deprecated in favor of zone.utcOffset");
          return this.offsets[this._index(mom)];
        },
        utcOffset: function(mom) {
          return this.offsets[this._index(mom)];
        }
      };
      function Country(country_name, zone_names) {
        this.name = country_name;
        this.zones = zone_names;
      }
      function OffsetAt(at) {
        var timeString = at.toTimeString();
        var abbr = timeString.match(/\([a-z ]+\)/i);
        if (abbr && abbr[0]) {
          abbr = abbr[0].match(/[A-Z]/g);
          abbr = abbr ? abbr.join("") : void 0;
        } else {
          abbr = timeString.match(/[A-Z]{3,5}/g);
          abbr = abbr ? abbr[0] : void 0;
        }
        if (abbr === "GMT") {
          abbr = void 0;
        }
        this.at = +at;
        this.abbr = abbr;
        this.offset = at.getTimezoneOffset();
      }
      function ZoneScore(zone) {
        this.zone = zone;
        this.offsetScore = 0;
        this.abbrScore = 0;
      }
      ZoneScore.prototype.scoreOffsetAt = function(offsetAt) {
        this.offsetScore += Math.abs(this.zone.utcOffset(offsetAt.at) - offsetAt.offset);
        if (this.zone.abbr(offsetAt.at).replace(/[^A-Z]/g, "") !== offsetAt.abbr) {
          this.abbrScore++;
        }
      };
      function findChange(low, high) {
        var mid, diff;
        while (diff = ((high.at - low.at) / 12e4 | 0) * 6e4) {
          mid = new OffsetAt(new Date(low.at + diff));
          if (mid.offset === low.offset) {
            low = mid;
          } else {
            high = mid;
          }
        }
        return low;
      }
      function userOffsets() {
        var startYear = (/* @__PURE__ */ new Date()).getFullYear() - 2, last = new OffsetAt(new Date(startYear, 0, 1)), lastOffset = last.offset, offsets = [last], change, next, nextOffset, i;
        for (i = 1; i < 48; i++) {
          nextOffset = new Date(startYear, i, 1).getTimezoneOffset();
          if (nextOffset !== lastOffset) {
            next = new OffsetAt(new Date(startYear, i, 1));
            change = findChange(last, next);
            offsets.push(change);
            offsets.push(new OffsetAt(new Date(change.at + 6e4)));
            last = next;
            lastOffset = nextOffset;
          }
        }
        for (i = 0; i < 4; i++) {
          offsets.push(new OffsetAt(new Date(startYear + i, 0, 1)));
          offsets.push(new OffsetAt(new Date(startYear + i, 6, 1)));
        }
        return offsets;
      }
      function sortZoneScores(a, b) {
        if (a.offsetScore !== b.offsetScore) {
          return a.offsetScore - b.offsetScore;
        }
        if (a.abbrScore !== b.abbrScore) {
          return a.abbrScore - b.abbrScore;
        }
        if (a.zone.population !== b.zone.population) {
          return b.zone.population - a.zone.population;
        }
        return b.zone.name.localeCompare(a.zone.name);
      }
      function addToGuesses(name, offsets) {
        var i, offset;
        arrayToInt(offsets);
        for (i = 0; i < offsets.length; i++) {
          offset = offsets[i];
          guesses[offset] = guesses[offset] || {};
          guesses[offset][name] = true;
        }
      }
      function guessesForUserOffsets(offsets) {
        var offsetsLength = offsets.length, filteredGuesses = {}, out = [], checkedOffsets = {}, i, j, offset, guessesOffset;
        for (i = 0; i < offsetsLength; i++) {
          offset = offsets[i].offset;
          if (checkedOffsets.hasOwnProperty(offset)) {
            continue;
          }
          guessesOffset = guesses[offset] || {};
          for (j in guessesOffset) {
            if (guessesOffset.hasOwnProperty(j)) {
              filteredGuesses[j] = true;
            }
          }
          checkedOffsets[offset] = true;
        }
        for (i in filteredGuesses) {
          if (filteredGuesses.hasOwnProperty(i)) {
            out.push(names[i]);
          }
        }
        return out;
      }
      function rebuildGuess() {
        try {
          var intlName = Intl.DateTimeFormat().resolvedOptions().timeZone;
          if (intlName && intlName.length > 3) {
            var name = names[normalizeName(intlName)];
            if (name) {
              return name;
            }
            logError("Moment Timezone found " + intlName + " from the Intl api, but did not have that data loaded.");
          }
        } catch (e) {
        }
        var offsets = userOffsets(), offsetsLength = offsets.length, guesses2 = guessesForUserOffsets(offsets), zoneScores = [], zoneScore, i, j;
        for (i = 0; i < guesses2.length; i++) {
          zoneScore = new ZoneScore(getZone(guesses2[i]), offsetsLength);
          for (j = 0; j < offsetsLength; j++) {
            zoneScore.scoreOffsetAt(offsets[j]);
          }
          zoneScores.push(zoneScore);
        }
        zoneScores.sort(sortZoneScores);
        return zoneScores.length > 0 ? zoneScores[0].zone.name : void 0;
      }
      function guess(ignoreCache) {
        if (!cachedGuess || ignoreCache) {
          cachedGuess = rebuildGuess();
        }
        return cachedGuess;
      }
      function normalizeName(name) {
        return (name || "").toLowerCase().replace(/\//g, "_");
      }
      function addZone(packed) {
        var i, name, split, normalized;
        if (typeof packed === "string") {
          packed = [packed];
        }
        for (i = 0; i < packed.length; i++) {
          split = packed[i].split("|");
          name = split[0];
          normalized = normalizeName(name);
          zones[normalized] = packed[i];
          names[normalized] = name;
          addToGuesses(normalized, split[2].split(" "));
        }
      }
      function getZone(name, caller) {
        name = normalizeName(name);
        var zone = zones[name];
        var link;
        if (zone instanceof Zone) {
          return zone;
        }
        if (typeof zone === "string") {
          zone = new Zone(zone);
          zones[name] = zone;
          return zone;
        }
        if (links[name] && caller !== getZone && (link = getZone(links[name], getZone))) {
          zone = zones[name] = new Zone();
          zone._set(link);
          zone.name = names[name];
          return zone;
        }
        return null;
      }
      function getNames() {
        var i, out = [];
        for (i in names) {
          if (names.hasOwnProperty(i) && (zones[i] || zones[links[i]]) && names[i]) {
            out.push(names[i]);
          }
        }
        return out.sort();
      }
      function getCountryNames() {
        return Object.keys(countries);
      }
      function addLink(aliases) {
        var i, alias, normal0, normal1;
        if (typeof aliases === "string") {
          aliases = [aliases];
        }
        for (i = 0; i < aliases.length; i++) {
          alias = aliases[i].split("|");
          normal0 = normalizeName(alias[0]);
          normal1 = normalizeName(alias[1]);
          links[normal0] = normal1;
          names[normal0] = alias[0];
          links[normal1] = normal0;
          names[normal1] = alias[1];
        }
      }
      function addCountries(data) {
        var i, country_code, country_zones, split;
        if (!data || !data.length) return;
        for (i = 0; i < data.length; i++) {
          split = data[i].split("|");
          country_code = split[0].toUpperCase();
          country_zones = split[1].split(" ");
          countries[country_code] = new Country(
            country_code,
            country_zones
          );
        }
      }
      function getCountry(name) {
        name = name.toUpperCase();
        return countries[name] || null;
      }
      function zonesForCountry(country, with_offset) {
        country = getCountry(country);
        if (!country) return null;
        var zones2 = country.zones.sort();
        if (with_offset) {
          return zones2.map(function(zone_name) {
            var zone = getZone(zone_name);
            return {
              name: zone_name,
              offset: zone.utcOffset(/* @__PURE__ */ new Date())
            };
          });
        }
        return zones2;
      }
      function loadData(data) {
        addZone(data.zones);
        addLink(data.links);
        addCountries(data.countries);
        tz.dataVersion = data.version;
      }
      function zoneExists(name) {
        if (!zoneExists.didShowError) {
          zoneExists.didShowError = true;
          logError("moment.tz.zoneExists('" + name + "') has been deprecated in favor of !moment.tz.zone('" + name + "')");
        }
        return !!getZone(name);
      }
      function needsOffset(m) {
        var isUnixTimestamp = m._f === "X" || m._f === "x";
        return !!(m._a && m._tzm === void 0 && !isUnixTimestamp);
      }
      function logError(message) {
        if (typeof console !== "undefined" && typeof console.error === "function") {
          console.error(message);
        }
      }
      function tz(input) {
        var args = Array.prototype.slice.call(arguments, 0, -1), name = arguments[arguments.length - 1], out = moment4.utc.apply(null, args), zone;
        if (!moment4.isMoment(input) && needsOffset(out) && (zone = getZone(name))) {
          out.add(zone.parse(out), "minutes");
        }
        out.tz(name);
        return out;
      }
      tz.version = VERSION;
      tz.dataVersion = "";
      tz._zones = zones;
      tz._links = links;
      tz._names = names;
      tz._countries = countries;
      tz.add = addZone;
      tz.link = addLink;
      tz.load = loadData;
      tz.zone = getZone;
      tz.zoneExists = zoneExists;
      tz.guess = guess;
      tz.names = getNames;
      tz.Zone = Zone;
      tz.unpack = unpack;
      tz.unpackBase60 = unpackBase60;
      tz.needsOffset = needsOffset;
      tz.moveInvalidForward = true;
      tz.moveAmbiguousForward = false;
      tz.countries = getCountryNames;
      tz.zonesForCountry = zonesForCountry;
      var fn = moment4.fn;
      moment4.tz = tz;
      moment4.defaultZone = null;
      moment4.updateOffset = function(mom, keepTime) {
        var zone = moment4.defaultZone, offset;
        if (mom._z === void 0) {
          if (zone && needsOffset(mom) && !mom._isUTC && mom.isValid()) {
            mom._d = moment4.utc(mom._a)._d;
            mom.utc().add(zone.parse(mom), "minutes");
          }
          mom._z = zone;
        }
        if (mom._z) {
          offset = mom._z.utcOffset(mom);
          if (Math.abs(offset) < 16) {
            offset = offset / 60;
          }
          if (mom.utcOffset !== void 0) {
            var z10 = mom._z;
            mom.utcOffset(-offset, keepTime);
            mom._z = z10;
          } else {
            mom.zone(offset, keepTime);
          }
        }
      };
      fn.tz = function(name, keepTime) {
        if (name) {
          if (typeof name !== "string") {
            throw new Error("Time zone name must be a string, got " + name + " [" + typeof name + "]");
          }
          this._z = getZone(name);
          if (this._z) {
            moment4.updateOffset(this, keepTime);
          } else {
            logError("Moment Timezone has no data for " + name + ". See http://momentjs.com/timezone/docs/#/data-loading/.");
          }
          return this;
        }
        if (this._z) {
          return this._z.name;
        }
      };
      function abbrWrap(old) {
        return function() {
          if (this._z) {
            return this._z.abbr(this);
          }
          return old.call(this);
        };
      }
      function resetZoneWrap(old) {
        return function() {
          this._z = null;
          return old.apply(this, arguments);
        };
      }
      function resetZoneWrap2(old) {
        return function() {
          if (arguments.length > 0) this._z = null;
          return old.apply(this, arguments);
        };
      }
      fn.zoneName = abbrWrap(fn.zoneName);
      fn.zoneAbbr = abbrWrap(fn.zoneAbbr);
      fn.utc = resetZoneWrap(fn.utc);
      fn.local = resetZoneWrap(fn.local);
      fn.utcOffset = resetZoneWrap2(fn.utcOffset);
      moment4.tz.setDefault = function(name) {
        if (major < 2 || major === 2 && minor < 9) {
          logError("Moment Timezone setDefault() requires Moment.js >= 2.9.0. You are using Moment.js " + moment4.version + ".");
        }
        moment4.defaultZone = name ? getZone(name) : null;
        return moment4;
      };
      var momentProperties = moment4.momentProperties;
      if (Object.prototype.toString.call(momentProperties) === "[object Array]") {
        momentProperties.push("_z");
        momentProperties.push("_a");
      } else if (momentProperties) {
        momentProperties._z = null;
      }
      loadData({
        "version": "2025a",
        "zones": [
          "Africa/Abidjan|GMT|0|0||48e5",
          "Africa/Nairobi|EAT|-30|0||47e5",
          "Africa/Algiers|CET|-10|0||26e5",
          "Africa/Lagos|WAT|-10|0||17e6",
          "Africa/Khartoum|CAT|-20|0||51e5",
          "Africa/Cairo|EET EEST|-20 -30|01010101010101010|29NW0 1cL0 1cN0 1fz0 1a10 1fz0 1a10 1fz0 1cN0 1cL0 1cN0 1cL0 1cN0 1cL0 1cN0 1fz0|15e6",
          "Africa/Casablanca|+01 +00|-10 0|010101010101010101010101|22sq0 gM0 2600 e00 2600 gM0 2600 e00 28M0 e00 2600 gM0 2600 e00 28M0 e00 2600 gM0 2600 e00 2600 gM0 2600|32e5",
          "Europe/Paris|CET CEST|-10 -20|01010101010101010101010|22k10 1o00 11A0 1qM0 WM0 1qM0 WM0 1qM0 11A0 1o00 11A0 1o00 11A0 1o00 11A0 1qM0 WM0 1qM0 WM0 1qM0 11A0 1o00|11e6",
          "Africa/Johannesburg|SAST|-20|0||84e5",
          "Africa/Juba|EAT CAT|-30 -20|01|24nx0|",
          "Africa/Tripoli|EET|-20|0||11e5",
          "America/Adak|HST HDT|a0 90|01010101010101010101010|22bM0 1zb0 Rd0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0 Rd0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0|326",
          "America/Anchorage|AKST AKDT|90 80|01010101010101010101010|22bL0 1zb0 Rd0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0 Rd0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0|30e4",
          "America/Santo_Domingo|AST|40|0||29e5",
          "America/Sao_Paulo|-03|30|0||20e6",
          "America/Asuncion|-03 -04|30 40|01010101010|22hf0 1ip0 19X0 1fB0 19X0 1fB0 19X0 1fB0 19X0 1ip0|28e5",
          "America/Panama|EST|50|0||15e5",
          "America/Mexico_City|CST CDT|60 50|0101010|22mU0 1lb0 14p0 1nX0 11B0 1nX0|20e6",
          "America/Managua|CST|60|0||22e5",
          "America/Caracas|-04|40|0||29e5",
          "America/Lima|-05|50|0||11e6",
          "America/Denver|MST MDT|70 60|01010101010101010101010|22bJ0 1zb0 Rd0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0 Rd0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0|26e5",
          "America/Chicago|CST CDT|60 50|01010101010101010101010|22bI0 1zb0 Rd0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0 Rd0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0|92e5",
          "America/Chihuahua|MST MDT CST|70 60 60|0101012|22mV0 1lb0 14p0 1nX0 11B0 1nX0|81e4",
          "America/Ciudad_Juarez|MST MDT CST|70 60 60|010101201010101010101010|22bJ0 1zb0 Rd0 1zb0 Op0 1wn0 cm0 EP0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0 Rd0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0|",
          "America/Phoenix|MST|70|0||42e5",
          "America/Whitehorse|PST PDT MST|80 70 70|012|22bK0 1z90|23e3",
          "America/New_York|EST EDT|50 40|01010101010101010101010|22bH0 1zb0 Rd0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0 Rd0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0|21e6",
          "America/Los_Angeles|PST PDT|80 70|01010101010101010101010|22bK0 1zb0 Rd0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0 Rd0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0|15e6",
          "America/Halifax|AST ADT|40 30|01010101010101010101010|22bG0 1zb0 Rd0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0 Rd0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0|39e4",
          "America/Godthab|-03 -02 -01|30 20 10|0101010121212121212121|22k10 1o00 11A0 1qM0 WM0 1qM0 WM0 2so0 1o00 11A0 1o00 11A0 1o00 11A0 1qM0 WM0 1qM0 WM0 1qM0 11A0 1o00|17e3",
          "America/Havana|CST CDT|50 40|01010101010101010101010|22bF0 1zc0 Rc0 1zc0 Oo0 1zc0 Oo0 1zc0 Oo0 1zc0 Oo0 1zc0 Oo0 1zc0 Rc0 1zc0 Oo0 1zc0 Oo0 1zc0 Oo0 1zc0|21e5",
          "America/Mazatlan|MST MDT|70 60|0101010|22mV0 1lb0 14p0 1nX0 11B0 1nX0|44e4",
          "America/Miquelon|-03 -02|30 20|01010101010101010101010|22bF0 1zb0 Rd0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0 Rd0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0|61e2",
          "America/Noronha|-02|20|0||30e2",
          "America/Ojinaga|MST MDT CST CDT|70 60 60 50|01010123232323232323232|22bJ0 1zb0 Rd0 1zb0 Op0 1wn0 Rc0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0 Rd0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0|23e3",
          "America/Santiago|-03 -04|30 40|01010101010101010101010|22mP0 11B0 1nX0 11B0 1nX0 14p0 1lb0 11B0 1qL0 11B0 1nX0 11B0 1nX0 11B0 1nX0 11B0 1nX0 11B0 1qL0 WN0 1qL0 11B0|62e5",
          "America/Scoresbysund|-01 +00 -02|10 0 20|0101010102020202020202|22k10 1o00 11A0 1qM0 WM0 1qM0 WM0 1qM0 2pA0 11A0 1o00 11A0 1o00 11A0 1qM0 WM0 1qM0 WM0 1qM0 11A0 1o00|452",
          "America/St_Johns|NST NDT|3u 2u|01010101010101010101010|22bFu 1zb0 Rd0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0 Rd0 1zb0 Op0 1zb0 Op0 1zb0 Op0 1zb0|11e4",
          "Antarctica/Casey|+11 +08|-b0 -80|01010101|22bs0 1o01 14kX 1lf1 14kX 1lf1 13bX|10",
          "Asia/Bangkok|+07|-70|0||15e6",
          "Asia/Vladivostok|+10|-a0|0||60e4",
          "Australia/Sydney|AEDT AEST|-b0 -a0|01010101010101010101010|22mE0 1cM0 1cM0 1cM0 1cM0 1cM0 1cM0 1cM0 1fA0 1cM0 1cM0 1cM0 1cM0 1cM0 1cM0 1cM0 1cM0 1cM0 1cM0 1fA0 1cM0 1cM0|40e5",
          "Asia/Tashkent|+05|-50|0||23e5",
          "Pacific/Auckland|NZDT NZST|-d0 -c0|01010101010101010101010|22mC0 1a00 1fA0 1a00 1fA0 1a00 1fA0 1a00 1io0 1a00 1fA0 1a00 1fA0 1a00 1fA0 1a00 1fA0 1a00 1fA0 1cM0 1fA0 1a00|14e5",
          "Europe/Istanbul|+03|-30|0||13e6",
          "Antarctica/Troll|+00 +02|0 -20|01010101010101010101010|22k10 1o00 11A0 1qM0 WM0 1qM0 WM0 1qM0 11A0 1o00 11A0 1o00 11A0 1o00 11A0 1qM0 WM0 1qM0 WM0 1qM0 11A0 1o00|40",
          "Antarctica/Vostok|+07 +05|-70 -50|01|2bnv0|25",
          "Asia/Almaty|+06 +05|-60 -50|01|2bR60|15e5",
          "Asia/Amman|EET EEST +03|-20 -30 -30|0101012|22ja0 1qM0 WM0 1qM0 LA0 1C00|25e5",
          "Asia/Kamchatka|+12|-c0|0||18e4",
          "Asia/Dubai|+04|-40|0||39e5",
          "Asia/Beirut|EET EEST|-20 -30|01010101010101010101010|22jW0 1nX0 11B0 1qL0 WN0 1qL0 WN0 1qL0 11B0 1nX0 11B0 1nX0 11B0 1nX0 11B0 1qL0 WN0 1qL0 WN0 1qL0 11B0 1nX0|22e5",
          "Asia/Dhaka|+06|-60|0||16e6",
          "Asia/Kuala_Lumpur|+08|-80|0||71e5",
          "Asia/Kolkata|IST|-5u|0||15e6",
          "Asia/Chita|+09|-90|0||33e4",
          "Asia/Shanghai|CST|-80|0||23e6",
          "Asia/Colombo|+0530|-5u|0||22e5",
          "Asia/Damascus|EET EEST +03|-20 -30 -30|0101012|22ja0 1qL0 WN0 1qL0 WN0 1qL0|26e5",
          "Europe/Athens|EET EEST|-20 -30|01010101010101010101010|22k10 1o00 11A0 1qM0 WM0 1qM0 WM0 1qM0 11A0 1o00 11A0 1o00 11A0 1o00 11A0 1qM0 WM0 1qM0 WM0 1qM0 11A0 1o00|35e5",
          "Asia/Gaza|EET EEST|-20 -30|01010101010101010101010|22jy0 1o00 11A0 1qo0 XA0 1qp0 1cN0 1cL0 1a10 1fz0 17d0 1in0 11B0 1nX0 11B0 1qL0 WN0 1qL0 WN0 1qL0 11B0 1nX0|18e5",
          "Asia/Hong_Kong|HKT|-80|0||73e5",
          "Asia/Jakarta|WIB|-70|0||31e6",
          "Asia/Jayapura|WIT|-90|0||26e4",
          "Asia/Jerusalem|IST IDT|-20 -30|01010101010101010101010|22jc0 1oL0 10N0 1rz0 W10 1rz0 W10 1rz0 10N0 1oL0 10N0 1oL0 10N0 1oL0 10N0 1rz0 W10 1rz0 W10 1rz0 10N0 1oL0|81e4",
          "Asia/Kabul|+0430|-4u|0||46e5",
          "Asia/Karachi|PKT|-50|0||24e6",
          "Asia/Kathmandu|+0545|-5J|0||12e5",
          "Asia/Sakhalin|+11|-b0|0||58e4",
          "Asia/Makassar|WITA|-80|0||15e5",
          "Asia/Manila|PST|-80|0||24e6",
          "Asia/Seoul|KST|-90|0||23e6",
          "Asia/Rangoon|+0630|-6u|0||48e5",
          "Asia/Tehran|+0330 +0430|-3u -4u|0101010|22gIu 1dz0 1cN0 1dz0 1cp0 1dz0|14e6",
          "Asia/Tokyo|JST|-90|0||38e6",
          "Atlantic/Azores|-01 +00|10 0|01010101010101010101010|22k10 1o00 11A0 1qM0 WM0 1qM0 WM0 1qM0 11A0 1o00 11A0 1o00 11A0 1o00 11A0 1qM0 WM0 1qM0 WM0 1qM0 11A0 1o00|25e4",
          "Europe/Lisbon|WET WEST|0 -10|01010101010101010101010|22k10 1o00 11A0 1qM0 WM0 1qM0 WM0 1qM0 11A0 1o00 11A0 1o00 11A0 1o00 11A0 1qM0 WM0 1qM0 WM0 1qM0 11A0 1o00|27e5",
          "Atlantic/Cape_Verde|-01|10|0||50e4",
          "Australia/Adelaide|ACDT ACST|-au -9u|01010101010101010101010|22mEu 1cM0 1cM0 1cM0 1cM0 1cM0 1cM0 1cM0 1fA0 1cM0 1cM0 1cM0 1cM0 1cM0 1cM0 1cM0 1cM0 1cM0 1cM0 1fA0 1cM0 1cM0|11e5",
          "Australia/Brisbane|AEST|-a0|0||20e5",
          "Australia/Darwin|ACST|-9u|0||12e4",
          "Australia/Eucla|+0845|-8J|0||368",
          "Australia/Lord_Howe|+11 +1030|-b0 -au|01010101010101010101010|22mD0 1cMu 1cLu 1cMu 1cLu 1cMu 1cLu 1cMu 1fzu 1cMu 1cLu 1cMu 1cLu 1cMu 1cLu 1cMu 1cLu 1cMu 1cLu 1fAu 1cLu 1cMu|347",
          "Australia/Perth|AWST|-80|0||18e5",
          "Pacific/Easter|-05 -06|50 60|01010101010101010101010|22mP0 11B0 1nX0 11B0 1nX0 14p0 1lb0 11B0 1qL0 11B0 1nX0 11B0 1nX0 11B0 1nX0 11B0 1nX0 11B0 1qL0 WN0 1qL0 11B0|30e2",
          "Europe/Dublin|GMT IST|0 -10|01010101010101010101010|22k10 1o00 11A0 1qM0 WM0 1qM0 WM0 1qM0 11A0 1o00 11A0 1o00 11A0 1o00 11A0 1qM0 WM0 1qM0 WM0 1qM0 11A0 1o00|12e5",
          "Etc/GMT-1|+01|-10|0||",
          "Pacific/Tongatapu|+13|-d0|0||75e3",
          "Pacific/Kiritimati|+14|-e0|0||51e2",
          "Etc/GMT-2|+02|-20|0||",
          "Pacific/Tahiti|-10|a0|0||18e4",
          "Pacific/Niue|-11|b0|0||12e2",
          "Etc/GMT+12|-12|c0|0||",
          "Pacific/Galapagos|-06|60|0||25e3",
          "Etc/GMT+7|-07|70|0||",
          "Pacific/Pitcairn|-08|80|0||56",
          "Pacific/Gambier|-09|90|0||125",
          "Etc/UTC|UTC|0|0||",
          "Europe/London|GMT BST|0 -10|01010101010101010101010|22k10 1o00 11A0 1qM0 WM0 1qM0 WM0 1qM0 11A0 1o00 11A0 1o00 11A0 1o00 11A0 1qM0 WM0 1qM0 WM0 1qM0 11A0 1o00|10e6",
          "Europe/Chisinau|EET EEST|-20 -30|01010101010101010101010|22k00 1o00 11A0 1qM0 WM0 1qM0 WM0 1qM0 11A0 1o00 11A0 1o00 11A0 1o00 11A0 1qM0 WM0 1qM0 WM0 1qM0 11A0 1o00|67e4",
          "Europe/Moscow|MSK|-30|0||16e6",
          "Europe/Volgograd|+04 MSK|-40 -30|01|249a0|10e5",
          "Pacific/Honolulu|HST|a0|0||37e4",
          "Pacific/Chatham|+1345 +1245|-dJ -cJ|01010101010101010101010|22mC0 1a00 1fA0 1a00 1fA0 1a00 1fA0 1a00 1io0 1a00 1fA0 1a00 1fA0 1a00 1fA0 1a00 1fA0 1a00 1fA0 1cM0 1fA0 1a00|600",
          "Pacific/Apia|+14 +13|-e0 -d0|0101|22mC0 1a00 1fA0|37e3",
          "Pacific/Fiji|+13 +12|-d0 -c0|0101|21N20 2hc0 bc0|88e4",
          "Pacific/Guam|ChST|-a0|0||17e4",
          "Pacific/Marquesas|-0930|9u|0||86e2",
          "Pacific/Pago_Pago|SST|b0|0||37e2",
          "Pacific/Norfolk|+12 +11|-c0 -b0|01010101010101010101010|22mD0 1cM0 1cM0 1cM0 1cM0 1cM0 1cM0 1cM0 1fA0 1cM0 1cM0 1cM0 1cM0 1cM0 1cM0 1cM0 1cM0 1cM0 1cM0 1fA0 1cM0 1cM0|25e4"
        ],
        "links": [
          "Africa/Abidjan|Africa/Accra",
          "Africa/Abidjan|Africa/Bamako",
          "Africa/Abidjan|Africa/Banjul",
          "Africa/Abidjan|Africa/Bissau",
          "Africa/Abidjan|Africa/Conakry",
          "Africa/Abidjan|Africa/Dakar",
          "Africa/Abidjan|Africa/Freetown",
          "Africa/Abidjan|Africa/Lome",
          "Africa/Abidjan|Africa/Monrovia",
          "Africa/Abidjan|Africa/Nouakchott",
          "Africa/Abidjan|Africa/Ouagadougou",
          "Africa/Abidjan|Africa/Sao_Tome",
          "Africa/Abidjan|Africa/Timbuktu",
          "Africa/Abidjan|America/Danmarkshavn",
          "Africa/Abidjan|Atlantic/Reykjavik",
          "Africa/Abidjan|Atlantic/St_Helena",
          "Africa/Abidjan|Etc/GMT",
          "Africa/Abidjan|Etc/GMT+0",
          "Africa/Abidjan|Etc/GMT-0",
          "Africa/Abidjan|Etc/GMT0",
          "Africa/Abidjan|Etc/Greenwich",
          "Africa/Abidjan|GMT",
          "Africa/Abidjan|GMT+0",
          "Africa/Abidjan|GMT-0",
          "Africa/Abidjan|GMT0",
          "Africa/Abidjan|Greenwich",
          "Africa/Abidjan|Iceland",
          "Africa/Algiers|Africa/Tunis",
          "Africa/Cairo|Egypt",
          "Africa/Casablanca|Africa/El_Aaiun",
          "Africa/Johannesburg|Africa/Maseru",
          "Africa/Johannesburg|Africa/Mbabane",
          "Africa/Khartoum|Africa/Blantyre",
          "Africa/Khartoum|Africa/Bujumbura",
          "Africa/Khartoum|Africa/Gaborone",
          "Africa/Khartoum|Africa/Harare",
          "Africa/Khartoum|Africa/Kigali",
          "Africa/Khartoum|Africa/Lubumbashi",
          "Africa/Khartoum|Africa/Lusaka",
          "Africa/Khartoum|Africa/Maputo",
          "Africa/Khartoum|Africa/Windhoek",
          "Africa/Lagos|Africa/Bangui",
          "Africa/Lagos|Africa/Brazzaville",
          "Africa/Lagos|Africa/Douala",
          "Africa/Lagos|Africa/Kinshasa",
          "Africa/Lagos|Africa/Libreville",
          "Africa/Lagos|Africa/Luanda",
          "Africa/Lagos|Africa/Malabo",
          "Africa/Lagos|Africa/Ndjamena",
          "Africa/Lagos|Africa/Niamey",
          "Africa/Lagos|Africa/Porto-Novo",
          "Africa/Nairobi|Africa/Addis_Ababa",
          "Africa/Nairobi|Africa/Asmara",
          "Africa/Nairobi|Africa/Asmera",
          "Africa/Nairobi|Africa/Dar_es_Salaam",
          "Africa/Nairobi|Africa/Djibouti",
          "Africa/Nairobi|Africa/Kampala",
          "Africa/Nairobi|Africa/Mogadishu",
          "Africa/Nairobi|Indian/Antananarivo",
          "Africa/Nairobi|Indian/Comoro",
          "Africa/Nairobi|Indian/Mayotte",
          "Africa/Tripoli|Europe/Kaliningrad",
          "Africa/Tripoli|Libya",
          "America/Adak|America/Atka",
          "America/Adak|US/Aleutian",
          "America/Anchorage|America/Juneau",
          "America/Anchorage|America/Metlakatla",
          "America/Anchorage|America/Nome",
          "America/Anchorage|America/Sitka",
          "America/Anchorage|America/Yakutat",
          "America/Anchorage|US/Alaska",
          "America/Caracas|America/Boa_Vista",
          "America/Caracas|America/Campo_Grande",
          "America/Caracas|America/Cuiaba",
          "America/Caracas|America/Guyana",
          "America/Caracas|America/La_Paz",
          "America/Caracas|America/Manaus",
          "America/Caracas|America/Porto_Velho",
          "America/Caracas|Brazil/West",
          "America/Caracas|Etc/GMT+4",
          "America/Chicago|America/Indiana/Knox",
          "America/Chicago|America/Indiana/Tell_City",
          "America/Chicago|America/Knox_IN",
          "America/Chicago|America/Matamoros",
          "America/Chicago|America/Menominee",
          "America/Chicago|America/North_Dakota/Beulah",
          "America/Chicago|America/North_Dakota/Center",
          "America/Chicago|America/North_Dakota/New_Salem",
          "America/Chicago|America/Rainy_River",
          "America/Chicago|America/Rankin_Inlet",
          "America/Chicago|America/Resolute",
          "America/Chicago|America/Winnipeg",
          "America/Chicago|CST6CDT",
          "America/Chicago|Canada/Central",
          "America/Chicago|US/Central",
          "America/Chicago|US/Indiana-Starke",
          "America/Denver|America/Boise",
          "America/Denver|America/Cambridge_Bay",
          "America/Denver|America/Edmonton",
          "America/Denver|America/Inuvik",
          "America/Denver|America/Shiprock",
          "America/Denver|America/Yellowknife",
          "America/Denver|Canada/Mountain",
          "America/Denver|MST7MDT",
          "America/Denver|Navajo",
          "America/Denver|US/Mountain",
          "America/Godthab|America/Nuuk",
          "America/Halifax|America/Glace_Bay",
          "America/Halifax|America/Goose_Bay",
          "America/Halifax|America/Moncton",
          "America/Halifax|America/Thule",
          "America/Halifax|Atlantic/Bermuda",
          "America/Halifax|Canada/Atlantic",
          "America/Havana|Cuba",
          "America/Lima|America/Bogota",
          "America/Lima|America/Eirunepe",
          "America/Lima|America/Guayaquil",
          "America/Lima|America/Porto_Acre",
          "America/Lima|America/Rio_Branco",
          "America/Lima|Brazil/Acre",
          "America/Lima|Etc/GMT+5",
          "America/Los_Angeles|America/Ensenada",
          "America/Los_Angeles|America/Santa_Isabel",
          "America/Los_Angeles|America/Tijuana",
          "America/Los_Angeles|America/Vancouver",
          "America/Los_Angeles|Canada/Pacific",
          "America/Los_Angeles|Mexico/BajaNorte",
          "America/Los_Angeles|PST8PDT",
          "America/Los_Angeles|US/Pacific",
          "America/Managua|America/Belize",
          "America/Managua|America/Costa_Rica",
          "America/Managua|America/El_Salvador",
          "America/Managua|America/Guatemala",
          "America/Managua|America/Regina",
          "America/Managua|America/Swift_Current",
          "America/Managua|America/Tegucigalpa",
          "America/Managua|Canada/Saskatchewan",
          "America/Mazatlan|Mexico/BajaSur",
          "America/Mexico_City|America/Bahia_Banderas",
          "America/Mexico_City|America/Merida",
          "America/Mexico_City|America/Monterrey",
          "America/Mexico_City|Mexico/General",
          "America/New_York|America/Detroit",
          "America/New_York|America/Fort_Wayne",
          "America/New_York|America/Grand_Turk",
          "America/New_York|America/Indiana/Indianapolis",
          "America/New_York|America/Indiana/Marengo",
          "America/New_York|America/Indiana/Petersburg",
          "America/New_York|America/Indiana/Vevay",
          "America/New_York|America/Indiana/Vincennes",
          "America/New_York|America/Indiana/Winamac",
          "America/New_York|America/Indianapolis",
          "America/New_York|America/Iqaluit",
          "America/New_York|America/Kentucky/Louisville",
          "America/New_York|America/Kentucky/Monticello",
          "America/New_York|America/Louisville",
          "America/New_York|America/Montreal",
          "America/New_York|America/Nassau",
          "America/New_York|America/Nipigon",
          "America/New_York|America/Pangnirtung",
          "America/New_York|America/Port-au-Prince",
          "America/New_York|America/Thunder_Bay",
          "America/New_York|America/Toronto",
          "America/New_York|Canada/Eastern",
          "America/New_York|EST5EDT",
          "America/New_York|US/East-Indiana",
          "America/New_York|US/Eastern",
          "America/New_York|US/Michigan",
          "America/Noronha|Atlantic/South_Georgia",
          "America/Noronha|Brazil/DeNoronha",
          "America/Noronha|Etc/GMT+2",
          "America/Panama|America/Atikokan",
          "America/Panama|America/Cancun",
          "America/Panama|America/Cayman",
          "America/Panama|America/Coral_Harbour",
          "America/Panama|America/Jamaica",
          "America/Panama|EST",
          "America/Panama|Jamaica",
          "America/Phoenix|America/Creston",
          "America/Phoenix|America/Dawson_Creek",
          "America/Phoenix|America/Fort_Nelson",
          "America/Phoenix|America/Hermosillo",
          "America/Phoenix|MST",
          "America/Phoenix|US/Arizona",
          "America/Santiago|Chile/Continental",
          "America/Santo_Domingo|America/Anguilla",
          "America/Santo_Domingo|America/Antigua",
          "America/Santo_Domingo|America/Aruba",
          "America/Santo_Domingo|America/Barbados",
          "America/Santo_Domingo|America/Blanc-Sablon",
          "America/Santo_Domingo|America/Curacao",
          "America/Santo_Domingo|America/Dominica",
          "America/Santo_Domingo|America/Grenada",
          "America/Santo_Domingo|America/Guadeloupe",
          "America/Santo_Domingo|America/Kralendijk",
          "America/Santo_Domingo|America/Lower_Princes",
          "America/Santo_Domingo|America/Marigot",
          "America/Santo_Domingo|America/Martinique",
          "America/Santo_Domingo|America/Montserrat",
          "America/Santo_Domingo|America/Port_of_Spain",
          "America/Santo_Domingo|America/Puerto_Rico",
          "America/Santo_Domingo|America/St_Barthelemy",
          "America/Santo_Domingo|America/St_Kitts",
          "America/Santo_Domingo|America/St_Lucia",
          "America/Santo_Domingo|America/St_Thomas",
          "America/Santo_Domingo|America/St_Vincent",
          "America/Santo_Domingo|America/Tortola",
          "America/Santo_Domingo|America/Virgin",
          "America/Sao_Paulo|America/Araguaina",
          "America/Sao_Paulo|America/Argentina/Buenos_Aires",
          "America/Sao_Paulo|America/Argentina/Catamarca",
          "America/Sao_Paulo|America/Argentina/ComodRivadavia",
          "America/Sao_Paulo|America/Argentina/Cordoba",
          "America/Sao_Paulo|America/Argentina/Jujuy",
          "America/Sao_Paulo|America/Argentina/La_Rioja",
          "America/Sao_Paulo|America/Argentina/Mendoza",
          "America/Sao_Paulo|America/Argentina/Rio_Gallegos",
          "America/Sao_Paulo|America/Argentina/Salta",
          "America/Sao_Paulo|America/Argentina/San_Juan",
          "America/Sao_Paulo|America/Argentina/San_Luis",
          "America/Sao_Paulo|America/Argentina/Tucuman",
          "America/Sao_Paulo|America/Argentina/Ushuaia",
          "America/Sao_Paulo|America/Bahia",
          "America/Sao_Paulo|America/Belem",
          "America/Sao_Paulo|America/Buenos_Aires",
          "America/Sao_Paulo|America/Catamarca",
          "America/Sao_Paulo|America/Cayenne",
          "America/Sao_Paulo|America/Cordoba",
          "America/Sao_Paulo|America/Fortaleza",
          "America/Sao_Paulo|America/Jujuy",
          "America/Sao_Paulo|America/Maceio",
          "America/Sao_Paulo|America/Mendoza",
          "America/Sao_Paulo|America/Montevideo",
          "America/Sao_Paulo|America/Paramaribo",
          "America/Sao_Paulo|America/Punta_Arenas",
          "America/Sao_Paulo|America/Recife",
          "America/Sao_Paulo|America/Rosario",
          "America/Sao_Paulo|America/Santarem",
          "America/Sao_Paulo|Antarctica/Palmer",
          "America/Sao_Paulo|Antarctica/Rothera",
          "America/Sao_Paulo|Atlantic/Stanley",
          "America/Sao_Paulo|Brazil/East",
          "America/Sao_Paulo|Etc/GMT+3",
          "America/St_Johns|Canada/Newfoundland",
          "America/Whitehorse|America/Dawson",
          "America/Whitehorse|Canada/Yukon",
          "Asia/Almaty|Asia/Qostanay",
          "Asia/Bangkok|Antarctica/Davis",
          "Asia/Bangkok|Asia/Barnaul",
          "Asia/Bangkok|Asia/Ho_Chi_Minh",
          "Asia/Bangkok|Asia/Hovd",
          "Asia/Bangkok|Asia/Krasnoyarsk",
          "Asia/Bangkok|Asia/Novokuznetsk",
          "Asia/Bangkok|Asia/Novosibirsk",
          "Asia/Bangkok|Asia/Phnom_Penh",
          "Asia/Bangkok|Asia/Saigon",
          "Asia/Bangkok|Asia/Tomsk",
          "Asia/Bangkok|Asia/Vientiane",
          "Asia/Bangkok|Etc/GMT-7",
          "Asia/Bangkok|Indian/Christmas",
          "Asia/Chita|Asia/Dili",
          "Asia/Chita|Asia/Khandyga",
          "Asia/Chita|Asia/Yakutsk",
          "Asia/Chita|Etc/GMT-9",
          "Asia/Chita|Pacific/Palau",
          "Asia/Dhaka|Asia/Bishkek",
          "Asia/Dhaka|Asia/Dacca",
          "Asia/Dhaka|Asia/Kashgar",
          "Asia/Dhaka|Asia/Omsk",
          "Asia/Dhaka|Asia/Thimbu",
          "Asia/Dhaka|Asia/Thimphu",
          "Asia/Dhaka|Asia/Urumqi",
          "Asia/Dhaka|Etc/GMT-6",
          "Asia/Dhaka|Indian/Chagos",
          "Asia/Dubai|Asia/Baku",
          "Asia/Dubai|Asia/Muscat",
          "Asia/Dubai|Asia/Tbilisi",
          "Asia/Dubai|Asia/Yerevan",
          "Asia/Dubai|Etc/GMT-4",
          "Asia/Dubai|Europe/Astrakhan",
          "Asia/Dubai|Europe/Samara",
          "Asia/Dubai|Europe/Saratov",
          "Asia/Dubai|Europe/Ulyanovsk",
          "Asia/Dubai|Indian/Mahe",
          "Asia/Dubai|Indian/Mauritius",
          "Asia/Dubai|Indian/Reunion",
          "Asia/Gaza|Asia/Hebron",
          "Asia/Hong_Kong|Hongkong",
          "Asia/Jakarta|Asia/Pontianak",
          "Asia/Jerusalem|Asia/Tel_Aviv",
          "Asia/Jerusalem|Israel",
          "Asia/Kamchatka|Asia/Anadyr",
          "Asia/Kamchatka|Etc/GMT-12",
          "Asia/Kamchatka|Kwajalein",
          "Asia/Kamchatka|Pacific/Funafuti",
          "Asia/Kamchatka|Pacific/Kwajalein",
          "Asia/Kamchatka|Pacific/Majuro",
          "Asia/Kamchatka|Pacific/Nauru",
          "Asia/Kamchatka|Pacific/Tarawa",
          "Asia/Kamchatka|Pacific/Wake",
          "Asia/Kamchatka|Pacific/Wallis",
          "Asia/Kathmandu|Asia/Katmandu",
          "Asia/Kolkata|Asia/Calcutta",
          "Asia/Kuala_Lumpur|Asia/Brunei",
          "Asia/Kuala_Lumpur|Asia/Choibalsan",
          "Asia/Kuala_Lumpur|Asia/Irkutsk",
          "Asia/Kuala_Lumpur|Asia/Kuching",
          "Asia/Kuala_Lumpur|Asia/Singapore",
          "Asia/Kuala_Lumpur|Asia/Ulaanbaatar",
          "Asia/Kuala_Lumpur|Asia/Ulan_Bator",
          "Asia/Kuala_Lumpur|Etc/GMT-8",
          "Asia/Kuala_Lumpur|Singapore",
          "Asia/Makassar|Asia/Ujung_Pandang",
          "Asia/Rangoon|Asia/Yangon",
          "Asia/Rangoon|Indian/Cocos",
          "Asia/Sakhalin|Asia/Magadan",
          "Asia/Sakhalin|Asia/Srednekolymsk",
          "Asia/Sakhalin|Etc/GMT-11",
          "Asia/Sakhalin|Pacific/Bougainville",
          "Asia/Sakhalin|Pacific/Efate",
          "Asia/Sakhalin|Pacific/Guadalcanal",
          "Asia/Sakhalin|Pacific/Kosrae",
          "Asia/Sakhalin|Pacific/Noumea",
          "Asia/Sakhalin|Pacific/Pohnpei",
          "Asia/Sakhalin|Pacific/Ponape",
          "Asia/Seoul|Asia/Pyongyang",
          "Asia/Seoul|ROK",
          "Asia/Shanghai|Asia/Chongqing",
          "Asia/Shanghai|Asia/Chungking",
          "Asia/Shanghai|Asia/Harbin",
          "Asia/Shanghai|Asia/Macao",
          "Asia/Shanghai|Asia/Macau",
          "Asia/Shanghai|Asia/Taipei",
          "Asia/Shanghai|PRC",
          "Asia/Shanghai|ROC",
          "Asia/Tashkent|Antarctica/Mawson",
          "Asia/Tashkent|Asia/Aqtau",
          "Asia/Tashkent|Asia/Aqtobe",
          "Asia/Tashkent|Asia/Ashgabat",
          "Asia/Tashkent|Asia/Ashkhabad",
          "Asia/Tashkent|Asia/Atyrau",
          "Asia/Tashkent|Asia/Dushanbe",
          "Asia/Tashkent|Asia/Oral",
          "Asia/Tashkent|Asia/Qyzylorda",
          "Asia/Tashkent|Asia/Samarkand",
          "Asia/Tashkent|Asia/Yekaterinburg",
          "Asia/Tashkent|Etc/GMT-5",
          "Asia/Tashkent|Indian/Kerguelen",
          "Asia/Tashkent|Indian/Maldives",
          "Asia/Tehran|Iran",
          "Asia/Tokyo|Japan",
          "Asia/Vladivostok|Antarctica/DumontDUrville",
          "Asia/Vladivostok|Asia/Ust-Nera",
          "Asia/Vladivostok|Etc/GMT-10",
          "Asia/Vladivostok|Pacific/Chuuk",
          "Asia/Vladivostok|Pacific/Port_Moresby",
          "Asia/Vladivostok|Pacific/Truk",
          "Asia/Vladivostok|Pacific/Yap",
          "Atlantic/Cape_Verde|Etc/GMT+1",
          "Australia/Adelaide|Australia/Broken_Hill",
          "Australia/Adelaide|Australia/South",
          "Australia/Adelaide|Australia/Yancowinna",
          "Australia/Brisbane|Australia/Lindeman",
          "Australia/Brisbane|Australia/Queensland",
          "Australia/Darwin|Australia/North",
          "Australia/Lord_Howe|Australia/LHI",
          "Australia/Perth|Australia/West",
          "Australia/Sydney|Antarctica/Macquarie",
          "Australia/Sydney|Australia/ACT",
          "Australia/Sydney|Australia/Canberra",
          "Australia/Sydney|Australia/Currie",
          "Australia/Sydney|Australia/Hobart",
          "Australia/Sydney|Australia/Melbourne",
          "Australia/Sydney|Australia/NSW",
          "Australia/Sydney|Australia/Tasmania",
          "Australia/Sydney|Australia/Victoria",
          "Etc/UTC|Etc/UCT",
          "Etc/UTC|Etc/Universal",
          "Etc/UTC|Etc/Zulu",
          "Etc/UTC|UCT",
          "Etc/UTC|UTC",
          "Etc/UTC|Universal",
          "Etc/UTC|Zulu",
          "Europe/Athens|Asia/Famagusta",
          "Europe/Athens|Asia/Nicosia",
          "Europe/Athens|EET",
          "Europe/Athens|Europe/Bucharest",
          "Europe/Athens|Europe/Helsinki",
          "Europe/Athens|Europe/Kiev",
          "Europe/Athens|Europe/Kyiv",
          "Europe/Athens|Europe/Mariehamn",
          "Europe/Athens|Europe/Nicosia",
          "Europe/Athens|Europe/Riga",
          "Europe/Athens|Europe/Sofia",
          "Europe/Athens|Europe/Tallinn",
          "Europe/Athens|Europe/Uzhgorod",
          "Europe/Athens|Europe/Vilnius",
          "Europe/Athens|Europe/Zaporozhye",
          "Europe/Chisinau|Europe/Tiraspol",
          "Europe/Dublin|Eire",
          "Europe/Istanbul|Antarctica/Syowa",
          "Europe/Istanbul|Asia/Aden",
          "Europe/Istanbul|Asia/Baghdad",
          "Europe/Istanbul|Asia/Bahrain",
          "Europe/Istanbul|Asia/Istanbul",
          "Europe/Istanbul|Asia/Kuwait",
          "Europe/Istanbul|Asia/Qatar",
          "Europe/Istanbul|Asia/Riyadh",
          "Europe/Istanbul|Etc/GMT-3",
          "Europe/Istanbul|Europe/Minsk",
          "Europe/Istanbul|Turkey",
          "Europe/Lisbon|Atlantic/Canary",
          "Europe/Lisbon|Atlantic/Faeroe",
          "Europe/Lisbon|Atlantic/Faroe",
          "Europe/Lisbon|Atlantic/Madeira",
          "Europe/Lisbon|Portugal",
          "Europe/Lisbon|WET",
          "Europe/London|Europe/Belfast",
          "Europe/London|Europe/Guernsey",
          "Europe/London|Europe/Isle_of_Man",
          "Europe/London|Europe/Jersey",
          "Europe/London|GB",
          "Europe/London|GB-Eire",
          "Europe/Moscow|Europe/Kirov",
          "Europe/Moscow|Europe/Simferopol",
          "Europe/Moscow|W-SU",
          "Europe/Paris|Africa/Ceuta",
          "Europe/Paris|Arctic/Longyearbyen",
          "Europe/Paris|Atlantic/Jan_Mayen",
          "Europe/Paris|CET",
          "Europe/Paris|Europe/Amsterdam",
          "Europe/Paris|Europe/Andorra",
          "Europe/Paris|Europe/Belgrade",
          "Europe/Paris|Europe/Berlin",
          "Europe/Paris|Europe/Bratislava",
          "Europe/Paris|Europe/Brussels",
          "Europe/Paris|Europe/Budapest",
          "Europe/Paris|Europe/Busingen",
          "Europe/Paris|Europe/Copenhagen",
          "Europe/Paris|Europe/Gibraltar",
          "Europe/Paris|Europe/Ljubljana",
          "Europe/Paris|Europe/Luxembourg",
          "Europe/Paris|Europe/Madrid",
          "Europe/Paris|Europe/Malta",
          "Europe/Paris|Europe/Monaco",
          "Europe/Paris|Europe/Oslo",
          "Europe/Paris|Europe/Podgorica",
          "Europe/Paris|Europe/Prague",
          "Europe/Paris|Europe/Rome",
          "Europe/Paris|Europe/San_Marino",
          "Europe/Paris|Europe/Sarajevo",
          "Europe/Paris|Europe/Skopje",
          "Europe/Paris|Europe/Stockholm",
          "Europe/Paris|Europe/Tirane",
          "Europe/Paris|Europe/Vaduz",
          "Europe/Paris|Europe/Vatican",
          "Europe/Paris|Europe/Vienna",
          "Europe/Paris|Europe/Warsaw",
          "Europe/Paris|Europe/Zagreb",
          "Europe/Paris|Europe/Zurich",
          "Europe/Paris|MET",
          "Europe/Paris|Poland",
          "Pacific/Auckland|Antarctica/McMurdo",
          "Pacific/Auckland|Antarctica/South_Pole",
          "Pacific/Auckland|NZ",
          "Pacific/Chatham|NZ-CHAT",
          "Pacific/Easter|Chile/EasterIsland",
          "Pacific/Galapagos|Etc/GMT+6",
          "Pacific/Gambier|Etc/GMT+9",
          "Pacific/Guam|Pacific/Saipan",
          "Pacific/Honolulu|HST",
          "Pacific/Honolulu|Pacific/Johnston",
          "Pacific/Honolulu|US/Hawaii",
          "Pacific/Kiritimati|Etc/GMT-14",
          "Pacific/Niue|Etc/GMT+11",
          "Pacific/Pago_Pago|Pacific/Midway",
          "Pacific/Pago_Pago|Pacific/Samoa",
          "Pacific/Pago_Pago|US/Samoa",
          "Pacific/Pitcairn|Etc/GMT+8",
          "Pacific/Tahiti|Etc/GMT+10",
          "Pacific/Tahiti|Pacific/Rarotonga",
          "Pacific/Tongatapu|Etc/GMT-13",
          "Pacific/Tongatapu|Pacific/Enderbury",
          "Pacific/Tongatapu|Pacific/Fakaofo",
          "Pacific/Tongatapu|Pacific/Kanton"
        ],
        "countries": [
          "AD|Europe/Andorra",
          "AE|Asia/Dubai",
          "AF|Asia/Kabul",
          "AG|America/Puerto_Rico America/Antigua",
          "AI|America/Puerto_Rico America/Anguilla",
          "AL|Europe/Tirane",
          "AM|Asia/Yerevan",
          "AO|Africa/Lagos Africa/Luanda",
          "AQ|Antarctica/Casey Antarctica/Davis Antarctica/Mawson Antarctica/Palmer Antarctica/Rothera Antarctica/Troll Antarctica/Vostok Pacific/Auckland Pacific/Port_Moresby Asia/Riyadh Asia/Singapore Antarctica/McMurdo Antarctica/DumontDUrville Antarctica/Syowa",
          "AR|America/Argentina/Buenos_Aires America/Argentina/Cordoba America/Argentina/Salta America/Argentina/Jujuy America/Argentina/Tucuman America/Argentina/Catamarca America/Argentina/La_Rioja America/Argentina/San_Juan America/Argentina/Mendoza America/Argentina/San_Luis America/Argentina/Rio_Gallegos America/Argentina/Ushuaia",
          "AS|Pacific/Pago_Pago",
          "AT|Europe/Vienna",
          "AU|Australia/Lord_Howe Antarctica/Macquarie Australia/Hobart Australia/Melbourne Australia/Sydney Australia/Broken_Hill Australia/Brisbane Australia/Lindeman Australia/Adelaide Australia/Darwin Australia/Perth Australia/Eucla Asia/Tokyo",
          "AW|America/Puerto_Rico America/Aruba",
          "AX|Europe/Helsinki Europe/Mariehamn",
          "AZ|Asia/Baku",
          "BA|Europe/Belgrade Europe/Sarajevo",
          "BB|America/Barbados",
          "BD|Asia/Dhaka",
          "BE|Europe/Brussels",
          "BF|Africa/Abidjan Africa/Ouagadougou",
          "BG|Europe/Sofia",
          "BH|Asia/Qatar Asia/Bahrain",
          "BI|Africa/Maputo Africa/Bujumbura",
          "BJ|Africa/Lagos Africa/Porto-Novo",
          "BL|America/Puerto_Rico America/St_Barthelemy",
          "BM|Atlantic/Bermuda",
          "BN|Asia/Kuching Asia/Brunei",
          "BO|America/La_Paz",
          "BQ|America/Puerto_Rico America/Kralendijk",
          "BR|America/Noronha America/Belem America/Fortaleza America/Recife America/Araguaina America/Maceio America/Bahia America/Sao_Paulo America/Campo_Grande America/Cuiaba America/Santarem America/Porto_Velho America/Boa_Vista America/Manaus America/Eirunepe America/Rio_Branco",
          "BS|America/Toronto America/Nassau",
          "BT|Asia/Thimphu",
          "BW|Africa/Maputo Africa/Gaborone",
          "BY|Europe/Minsk",
          "BZ|America/Belize",
          "CA|America/St_Johns America/Halifax America/Glace_Bay America/Moncton America/Goose_Bay America/Toronto America/Iqaluit America/Winnipeg America/Resolute America/Rankin_Inlet America/Regina America/Swift_Current America/Edmonton America/Cambridge_Bay America/Inuvik America/Dawson_Creek America/Fort_Nelson America/Whitehorse America/Dawson America/Vancouver America/Panama America/Puerto_Rico America/Phoenix America/Blanc-Sablon America/Atikokan America/Creston",
          "CC|Asia/Yangon Indian/Cocos",
          "CD|Africa/Maputo Africa/Lagos Africa/Kinshasa Africa/Lubumbashi",
          "CF|Africa/Lagos Africa/Bangui",
          "CG|Africa/Lagos Africa/Brazzaville",
          "CH|Europe/Zurich",
          "CI|Africa/Abidjan",
          "CK|Pacific/Rarotonga",
          "CL|America/Santiago America/Punta_Arenas Pacific/Easter",
          "CM|Africa/Lagos Africa/Douala",
          "CN|Asia/Shanghai Asia/Urumqi",
          "CO|America/Bogota",
          "CR|America/Costa_Rica",
          "CU|America/Havana",
          "CV|Atlantic/Cape_Verde",
          "CW|America/Puerto_Rico America/Curacao",
          "CX|Asia/Bangkok Indian/Christmas",
          "CY|Asia/Nicosia Asia/Famagusta",
          "CZ|Europe/Prague",
          "DE|Europe/Zurich Europe/Berlin Europe/Busingen",
          "DJ|Africa/Nairobi Africa/Djibouti",
          "DK|Europe/Berlin Europe/Copenhagen",
          "DM|America/Puerto_Rico America/Dominica",
          "DO|America/Santo_Domingo",
          "DZ|Africa/Algiers",
          "EC|America/Guayaquil Pacific/Galapagos",
          "EE|Europe/Tallinn",
          "EG|Africa/Cairo",
          "EH|Africa/El_Aaiun",
          "ER|Africa/Nairobi Africa/Asmara",
          "ES|Europe/Madrid Africa/Ceuta Atlantic/Canary",
          "ET|Africa/Nairobi Africa/Addis_Ababa",
          "FI|Europe/Helsinki",
          "FJ|Pacific/Fiji",
          "FK|Atlantic/Stanley",
          "FM|Pacific/Kosrae Pacific/Port_Moresby Pacific/Guadalcanal Pacific/Chuuk Pacific/Pohnpei",
          "FO|Atlantic/Faroe",
          "FR|Europe/Paris",
          "GA|Africa/Lagos Africa/Libreville",
          "GB|Europe/London",
          "GD|America/Puerto_Rico America/Grenada",
          "GE|Asia/Tbilisi",
          "GF|America/Cayenne",
          "GG|Europe/London Europe/Guernsey",
          "GH|Africa/Abidjan Africa/Accra",
          "GI|Europe/Gibraltar",
          "GL|America/Nuuk America/Danmarkshavn America/Scoresbysund America/Thule",
          "GM|Africa/Abidjan Africa/Banjul",
          "GN|Africa/Abidjan Africa/Conakry",
          "GP|America/Puerto_Rico America/Guadeloupe",
          "GQ|Africa/Lagos Africa/Malabo",
          "GR|Europe/Athens",
          "GS|Atlantic/South_Georgia",
          "GT|America/Guatemala",
          "GU|Pacific/Guam",
          "GW|Africa/Bissau",
          "GY|America/Guyana",
          "HK|Asia/Hong_Kong",
          "HN|America/Tegucigalpa",
          "HR|Europe/Belgrade Europe/Zagreb",
          "HT|America/Port-au-Prince",
          "HU|Europe/Budapest",
          "ID|Asia/Jakarta Asia/Pontianak Asia/Makassar Asia/Jayapura",
          "IE|Europe/Dublin",
          "IL|Asia/Jerusalem",
          "IM|Europe/London Europe/Isle_of_Man",
          "IN|Asia/Kolkata",
          "IO|Indian/Chagos",
          "IQ|Asia/Baghdad",
          "IR|Asia/Tehran",
          "IS|Africa/Abidjan Atlantic/Reykjavik",
          "IT|Europe/Rome",
          "JE|Europe/London Europe/Jersey",
          "JM|America/Jamaica",
          "JO|Asia/Amman",
          "JP|Asia/Tokyo",
          "KE|Africa/Nairobi",
          "KG|Asia/Bishkek",
          "KH|Asia/Bangkok Asia/Phnom_Penh",
          "KI|Pacific/Tarawa Pacific/Kanton Pacific/Kiritimati",
          "KM|Africa/Nairobi Indian/Comoro",
          "KN|America/Puerto_Rico America/St_Kitts",
          "KP|Asia/Pyongyang",
          "KR|Asia/Seoul",
          "KW|Asia/Riyadh Asia/Kuwait",
          "KY|America/Panama America/Cayman",
          "KZ|Asia/Almaty Asia/Qyzylorda Asia/Qostanay Asia/Aqtobe Asia/Aqtau Asia/Atyrau Asia/Oral",
          "LA|Asia/Bangkok Asia/Vientiane",
          "LB|Asia/Beirut",
          "LC|America/Puerto_Rico America/St_Lucia",
          "LI|Europe/Zurich Europe/Vaduz",
          "LK|Asia/Colombo",
          "LR|Africa/Monrovia",
          "LS|Africa/Johannesburg Africa/Maseru",
          "LT|Europe/Vilnius",
          "LU|Europe/Brussels Europe/Luxembourg",
          "LV|Europe/Riga",
          "LY|Africa/Tripoli",
          "MA|Africa/Casablanca",
          "MC|Europe/Paris Europe/Monaco",
          "MD|Europe/Chisinau",
          "ME|Europe/Belgrade Europe/Podgorica",
          "MF|America/Puerto_Rico America/Marigot",
          "MG|Africa/Nairobi Indian/Antananarivo",
          "MH|Pacific/Tarawa Pacific/Kwajalein Pacific/Majuro",
          "MK|Europe/Belgrade Europe/Skopje",
          "ML|Africa/Abidjan Africa/Bamako",
          "MM|Asia/Yangon",
          "MN|Asia/Ulaanbaatar Asia/Hovd",
          "MO|Asia/Macau",
          "MP|Pacific/Guam Pacific/Saipan",
          "MQ|America/Martinique",
          "MR|Africa/Abidjan Africa/Nouakchott",
          "MS|America/Puerto_Rico America/Montserrat",
          "MT|Europe/Malta",
          "MU|Indian/Mauritius",
          "MV|Indian/Maldives",
          "MW|Africa/Maputo Africa/Blantyre",
          "MX|America/Mexico_City America/Cancun America/Merida America/Monterrey America/Matamoros America/Chihuahua America/Ciudad_Juarez America/Ojinaga America/Mazatlan America/Bahia_Banderas America/Hermosillo America/Tijuana",
          "MY|Asia/Kuching Asia/Singapore Asia/Kuala_Lumpur",
          "MZ|Africa/Maputo",
          "NA|Africa/Windhoek",
          "NC|Pacific/Noumea",
          "NE|Africa/Lagos Africa/Niamey",
          "NF|Pacific/Norfolk",
          "NG|Africa/Lagos",
          "NI|America/Managua",
          "NL|Europe/Brussels Europe/Amsterdam",
          "NO|Europe/Berlin Europe/Oslo",
          "NP|Asia/Kathmandu",
          "NR|Pacific/Nauru",
          "NU|Pacific/Niue",
          "NZ|Pacific/Auckland Pacific/Chatham",
          "OM|Asia/Dubai Asia/Muscat",
          "PA|America/Panama",
          "PE|America/Lima",
          "PF|Pacific/Tahiti Pacific/Marquesas Pacific/Gambier",
          "PG|Pacific/Port_Moresby Pacific/Bougainville",
          "PH|Asia/Manila",
          "PK|Asia/Karachi",
          "PL|Europe/Warsaw",
          "PM|America/Miquelon",
          "PN|Pacific/Pitcairn",
          "PR|America/Puerto_Rico",
          "PS|Asia/Gaza Asia/Hebron",
          "PT|Europe/Lisbon Atlantic/Madeira Atlantic/Azores",
          "PW|Pacific/Palau",
          "PY|America/Asuncion",
          "QA|Asia/Qatar",
          "RE|Asia/Dubai Indian/Reunion",
          "RO|Europe/Bucharest",
          "RS|Europe/Belgrade",
          "RU|Europe/Kaliningrad Europe/Moscow Europe/Simferopol Europe/Kirov Europe/Volgograd Europe/Astrakhan Europe/Saratov Europe/Ulyanovsk Europe/Samara Asia/Yekaterinburg Asia/Omsk Asia/Novosibirsk Asia/Barnaul Asia/Tomsk Asia/Novokuznetsk Asia/Krasnoyarsk Asia/Irkutsk Asia/Chita Asia/Yakutsk Asia/Khandyga Asia/Vladivostok Asia/Ust-Nera Asia/Magadan Asia/Sakhalin Asia/Srednekolymsk Asia/Kamchatka Asia/Anadyr",
          "RW|Africa/Maputo Africa/Kigali",
          "SA|Asia/Riyadh",
          "SB|Pacific/Guadalcanal",
          "SC|Asia/Dubai Indian/Mahe",
          "SD|Africa/Khartoum",
          "SE|Europe/Berlin Europe/Stockholm",
          "SG|Asia/Singapore",
          "SH|Africa/Abidjan Atlantic/St_Helena",
          "SI|Europe/Belgrade Europe/Ljubljana",
          "SJ|Europe/Berlin Arctic/Longyearbyen",
          "SK|Europe/Prague Europe/Bratislava",
          "SL|Africa/Abidjan Africa/Freetown",
          "SM|Europe/Rome Europe/San_Marino",
          "SN|Africa/Abidjan Africa/Dakar",
          "SO|Africa/Nairobi Africa/Mogadishu",
          "SR|America/Paramaribo",
          "SS|Africa/Juba",
          "ST|Africa/Sao_Tome",
          "SV|America/El_Salvador",
          "SX|America/Puerto_Rico America/Lower_Princes",
          "SY|Asia/Damascus",
          "SZ|Africa/Johannesburg Africa/Mbabane",
          "TC|America/Grand_Turk",
          "TD|Africa/Ndjamena",
          "TF|Asia/Dubai Indian/Maldives Indian/Kerguelen",
          "TG|Africa/Abidjan Africa/Lome",
          "TH|Asia/Bangkok",
          "TJ|Asia/Dushanbe",
          "TK|Pacific/Fakaofo",
          "TL|Asia/Dili",
          "TM|Asia/Ashgabat",
          "TN|Africa/Tunis",
          "TO|Pacific/Tongatapu",
          "TR|Europe/Istanbul",
          "TT|America/Puerto_Rico America/Port_of_Spain",
          "TV|Pacific/Tarawa Pacific/Funafuti",
          "TW|Asia/Taipei",
          "TZ|Africa/Nairobi Africa/Dar_es_Salaam",
          "UA|Europe/Simferopol Europe/Kyiv",
          "UG|Africa/Nairobi Africa/Kampala",
          "UM|Pacific/Pago_Pago Pacific/Tarawa Pacific/Midway Pacific/Wake",
          "US|America/New_York America/Detroit America/Kentucky/Louisville America/Kentucky/Monticello America/Indiana/Indianapolis America/Indiana/Vincennes America/Indiana/Winamac America/Indiana/Marengo America/Indiana/Petersburg America/Indiana/Vevay America/Chicago America/Indiana/Tell_City America/Indiana/Knox America/Menominee America/North_Dakota/Center America/North_Dakota/New_Salem America/North_Dakota/Beulah America/Denver America/Boise America/Phoenix America/Los_Angeles America/Anchorage America/Juneau America/Sitka America/Metlakatla America/Yakutat America/Nome America/Adak Pacific/Honolulu",
          "UY|America/Montevideo",
          "UZ|Asia/Samarkand Asia/Tashkent",
          "VA|Europe/Rome Europe/Vatican",
          "VC|America/Puerto_Rico America/St_Vincent",
          "VE|America/Caracas",
          "VG|America/Puerto_Rico America/Tortola",
          "VI|America/Puerto_Rico America/St_Thomas",
          "VN|Asia/Bangkok Asia/Ho_Chi_Minh",
          "VU|Pacific/Efate",
          "WF|Pacific/Tarawa Pacific/Wallis",
          "WS|Pacific/Apia",
          "YE|Asia/Riyadh Asia/Aden",
          "YT|Africa/Nairobi Indian/Mayotte",
          "ZA|Africa/Johannesburg",
          "ZM|Africa/Maputo Africa/Lusaka",
          "ZW|Africa/Maputo Africa/Harare"
        ]
      });
      return moment4;
    });
  }
});

// index.ts
import { randomUUID as randomUUID2 } from "crypto";
import fastify from "fastify";
import FastifyAuthProvider from "@fastify/auth";

// plugins/auth.ts
import fp from "fastify-plugin";
import jwksClient from "jwks-rsa";
import jwt from "jsonwebtoken";
import {
  GetSecretValueCommand
} from "@aws-sdk/client-secrets-manager";

// ../common/errors/index.ts
var BaseError = class extends Error {
  name;
  id;
  message;
  httpStatusCode;
  constructor({ name, id, message, httpStatusCode }) {
    super(message || name || "Error");
    this.name = name;
    this.id = id;
    this.message = message;
    this.httpStatusCode = httpStatusCode;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
  toString() {
    return `Error ${this.id} (${this.name}): ${this.message}

${this.stack}`;
  }
  toJson() {
    return {
      error: true,
      name: this.name,
      id: this.id,
      message: this.message
    };
  }
};
var UnauthorizedError = class extends BaseError {
  constructor({ message }) {
    super({ name: "UnauthorizedError", id: 101, message, httpStatusCode: 401 });
  }
};
var UnauthenticatedError = class extends BaseError {
  constructor({ message }) {
    super({
      name: "UnauthenticatedError",
      id: 102,
      message,
      httpStatusCode: 403
    });
  }
};
var InternalServerError = class extends BaseError {
  constructor({ message } = {}) {
    super({
      name: "InternalServerError",
      id: 100,
      message: message || "An internal server error occurred. Please try again or contact support.",
      httpStatusCode: 500
    });
  }
};
var NotFoundError = class extends BaseError {
  constructor({ endpointName }) {
    super({
      name: "NotFoundError",
      id: 103,
      message: `${endpointName} is not a valid URL.`,
      httpStatusCode: 404
    });
  }
};
var ValidationError = class extends BaseError {
  constructor({ message }) {
    super({
      name: "ValidationError",
      id: 104,
      message,
      httpStatusCode: 400
    });
  }
};
var DatabaseInsertError = class extends BaseError {
  constructor({ message }) {
    super({
      name: "DatabaseInsertError",
      id: 105,
      message,
      httpStatusCode: 500
    });
  }
};
var DatabaseFetchError = class extends BaseError {
  constructor({ message }) {
    super({
      name: "DatabaseFetchError",
      id: 106,
      message,
      httpStatusCode: 500
    });
  }
};
var DiscordEventError = class extends BaseError {
  constructor({ message }) {
    super({
      name: "DiscordEventError",
      id: 107,
      message: message || "Could not create Discord event.",
      httpStatusCode: 500
    });
  }
};
var EntraInvitationError = class extends BaseError {
  email;
  constructor({ message, email }) {
    super({
      name: "EntraInvitationError",
      id: 108,
      message: message || "Could not invite user to Entra ID.",
      httpStatusCode: 400
    });
    this.email = email;
  }
};
var TicketNotFoundError = class extends BaseError {
  constructor({ message }) {
    super({
      name: "TicketNotFoundError",
      id: 108,
      message: message || "Could not find the ticket presented.",
      httpStatusCode: 404
    });
  }
};
var TicketNotValidError = class extends BaseError {
  constructor({ message }) {
    super({
      name: "TicketNotValidError",
      id: 109,
      message: message || "Ticket presented was found but is not valid.",
      httpStatusCode: 400
    });
  }
};
var NotSupportedError = class extends BaseError {
  constructor({ message }) {
    super({
      name: "NotSupportedError",
      id: 110,
      message: message || "This operation is not supported.",
      httpStatusCode: 400
    });
  }
};
var EntraGroupError = class extends BaseError {
  group;
  constructor({
    code,
    message,
    group
  }) {
    super({
      name: "EntraGroupError",
      id: 308,
      message: message || `Could not modify the group membership for group ${group}.`,
      httpStatusCode: code || 500
    });
    this.group = group;
  }
};

// ../common/roles.ts
var runEnvironments = ["dev", "prod"];
var AppRoles = /* @__PURE__ */ ((AppRoles3) => {
  AppRoles3["EVENTS_MANAGER"] = "manage:events";
  AppRoles3["TICKETS_SCANNER"] = "scan:tickets";
  AppRoles3["TICKETS_MANAGER"] = "manage:tickets";
  AppRoles3["IAM_ADMIN"] = "admin:iam";
  AppRoles3["IAM_INVITE_ONLY"] = "invite:iam";
  AppRoles3["STRIPE_LINK_CREATOR"] = "create:stripeLink";
  AppRoles3["BYPASS_OBJECT_LEVEL_AUTH"] = "bypass:ola";
  return AppRoles3;
})(AppRoles || {});
var allAppRoles = Object.values(AppRoles).filter(
  (value) => typeof value === "string"
);

// ../common/config.ts
var infraChairsGroupId = "48591dbc-cdcb-4544-9f63-e6b92b067e33";
var officersGroupId = "ff49e948-4587-416b-8224-65147540d5fc";
var officersGroupTestingId = "0e6e9199-506f-4ede-9d1b-e73f6811c9e5";
var execCouncilGroupId = "ad81254b-4eeb-4c96-8191-3acdce9194b1";
var execCouncilTestingGroupId = "dbe18eb2-9675-46c4-b1ef-749a6db4fedd";
var genericConfig = {
  EventsDynamoTableName: "infra-core-api-events",
  StripeLinksDynamoTableName: "infra-core-api-stripe-links",
  CacheDynamoTableName: "infra-core-api-cache",
  ConfigSecretName: "infra-core-api-config",
  UpcomingEventThresholdSeconds: 1800,
  // 30 mins
  AwsRegion: process.env.AWS_REGION || "us-east-1",
  EntraTenantId: "c8d9148f-9a59-4db3-827d-42ea0c2b6e2e",
  MerchStorePurchasesTableName: "infra-merchstore-purchase-history",
  MerchStoreMetadataTableName: "infra-merchstore-metadata",
  TicketPurchasesTableName: "infra-events-tickets",
  TicketMetadataTableName: "infra-events-ticketing-metadata",
  IAMTablePrefix: "infra-core-api-iam",
  ProtectedEntraIDGroups: [infraChairsGroupId, officersGroupId]
};
var environmentConfig = {
  dev: {
    AzureRoleMapping: { AutonomousWriters: ["manage:events" /* EVENTS_MANAGER */] },
    ValidCorsOrigins: [
      "http://localhost:3000",
      "http://localhost:5173",
      "http://localhost:5174",
      "https://merch-pwa.pages.dev",
      "https://manage.qa.acmuiuc.org",
      /^https:\/\/(?:.*\.)?acmuiuc\.pages\.dev$/
    ],
    AadValidClientId: "39c28870-94e4-47ee-b4fb-affe0bf96c9f",
    PasskitIdentifier: "pass.org.acmuiuc.qa.membership",
    PasskitSerialNumber: "0",
    MembershipApiEndpoint: "https://infra-membership-api.aws.qa.acmuiuc.org/api/v1/checkMembership",
    EmailDomain: "aws.qa.acmuiuc.org",
    SqsQueueUrl: "https://sqs.us-east-1.amazonaws.com/427040638965/infra-core-api-sqs"
  },
  prod: {
    AzureRoleMapping: { AutonomousWriters: ["manage:events" /* EVENTS_MANAGER */] },
    ValidCorsOrigins: [
      "https://acm.illinois.edu",
      "https://www.acm.illinois.edu",
      "https://manage.acm.illinois.edu",
      /^https:\/\/(?:.*\.)?acmuiuc\.pages\.dev$/
    ],
    AadValidClientId: "5e08cf0f-53bb-4e09-9df2-e9bdc3467296",
    PasskitIdentifier: "pass.edu.illinois.acm.membership",
    PasskitSerialNumber: "0",
    MembershipApiEndpoint: "https://infra-membership-api.aws.acmuiuc.org/api/v1/checkMembership",
    EmailDomain: "acm.illinois.edu",
    SqsQueueUrl: "https://sqs.us-east-1.amazonaws.com/298118738376/infra-core-api-sqs"
  }
};

// functions/authorization.ts
import { GetItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
var AUTH_DECISION_CACHE_SECONDS = 180;
async function getUserRoles(dynamoClient, fastifyApp, userId) {
  const cachedValue = fastifyApp.nodeCache.get(`userroles-${userId}`);
  if (cachedValue) {
    fastifyApp.log.info(`Returning cached auth decision for user ${userId}`);
    return cachedValue;
  }
  const tableName = `${genericConfig["IAMTablePrefix"]}-userroles`;
  const command = new GetItemCommand({
    TableName: tableName,
    Key: {
      userEmail: { S: userId }
    }
  });
  const response = await dynamoClient.send(command);
  if (!response) {
    throw new DatabaseFetchError({
      message: "Could not get user roles"
    });
  }
  if (!response.Item) {
    return [];
  }
  const items = unmarshall(response.Item);
  if (!("roles" in items)) {
    return [];
  }
  if (items["roles"][0] === "all") {
    fastifyApp.nodeCache.set(
      `userroles-${userId}`,
      allAppRoles,
      AUTH_DECISION_CACHE_SECONDS
    );
    return allAppRoles;
  }
  fastifyApp.nodeCache.set(
    `userroles-${userId}`,
    items["roles"],
    AUTH_DECISION_CACHE_SECONDS
  );
  return items["roles"];
}
async function getGroupRoles(dynamoClient, fastifyApp, groupId) {
  const cachedValue = fastifyApp.nodeCache.get(`grouproles-${groupId}`);
  if (cachedValue) {
    fastifyApp.log.info(`Returning cached auth decision for group ${groupId}`);
    return cachedValue;
  }
  const tableName = `${genericConfig["IAMTablePrefix"]}-grouproles`;
  const command = new GetItemCommand({
    TableName: tableName,
    Key: {
      groupUuid: { S: groupId }
    }
  });
  const response = await dynamoClient.send(command);
  if (!response) {
    throw new DatabaseFetchError({
      message: "Could not get group roles for user"
    });
  }
  if (!response.Item) {
    fastifyApp.nodeCache.set(
      `grouproles-${groupId}`,
      [],
      AUTH_DECISION_CACHE_SECONDS
    );
    return [];
  }
  const items = unmarshall(response.Item);
  if (!("roles" in items)) {
    fastifyApp.nodeCache.set(
      `grouproles-${groupId}`,
      [],
      AUTH_DECISION_CACHE_SECONDS
    );
    return [];
  }
  if (items["roles"][0] === "all") {
    fastifyApp.nodeCache.set(
      `grouproles-${groupId}`,
      allAppRoles,
      AUTH_DECISION_CACHE_SECONDS
    );
    return allAppRoles;
  }
  fastifyApp.nodeCache.set(
    `grouproles-${groupId}`,
    items["roles"],
    AUTH_DECISION_CACHE_SECONDS
  );
  return items["roles"];
}

// plugins/auth.ts
function intersection(setA, setB) {
  const _intersection = /* @__PURE__ */ new Set();
  for (const elem of setB) {
    if (setA.has(elem)) {
      _intersection.add(elem);
    }
  }
  return _intersection;
}
var getSecretValue = async (smClient, secretId) => {
  const data = await smClient.send(
    new GetSecretValueCommand({ SecretId: secretId })
  );
  if (!data.SecretString) {
    return null;
  }
  try {
    return JSON.parse(data.SecretString);
  } catch {
    return null;
  }
};
var authPlugin = async (fastify2, _options) => {
  fastify2.decorate(
    "authorize",
    async function(request, _reply, validRoles) {
      const userRoles = /* @__PURE__ */ new Set([]);
      try {
        const authHeader = request.headers.authorization;
        if (!authHeader) {
          throw new UnauthenticatedError({
            message: "Did not find bearer token in expected header."
          });
        }
        const [method, token] = authHeader.split(" ");
        if (method !== "Bearer") {
          throw new UnauthenticatedError({
            message: `Did not find bearer token, found ${method} token.`
          });
        }
        const decoded = jwt.decode(token, { complete: true });
        let signingKey = "";
        let verifyOptions = {};
        if (decoded?.payload.iss === "custom_jwt") {
          if (fastify2.runEnvironment === "prod") {
            throw new UnauthenticatedError({
              message: "Custom JWTs cannot be used in Prod environment."
            });
          }
          signingKey = process.env.JwtSigningKey || (await getSecretValue(
            fastify2.secretsManagerClient,
            genericConfig.ConfigSecretName
          ) || {
            jwt_key: ""
          }).jwt_key || "";
          if (signingKey === "") {
            throw new UnauthenticatedError({
              message: "Invalid token."
            });
          }
          verifyOptions = { algorithms: ["HS256"] };
        } else {
          const AadClientId = fastify2.environmentConfig.AadValidClientId;
          if (!AadClientId) {
            request.log.error(
              "Server is misconfigured, could not find `AadValidClientId`!"
            );
            throw new InternalServerError({
              message: "Server authentication is misconfigured, please contact your administrator."
            });
          }
          const header = decoded?.header;
          if (!header) {
            throw new UnauthenticatedError({
              message: "Could not decode token header."
            });
          }
          verifyOptions = {
            algorithms: ["RS256"],
            header: decoded?.header,
            audience: `api://${AadClientId}`
          };
          const client = jwksClient({
            jwksUri: "https://login.microsoftonline.com/common/discovery/keys"
          });
          signingKey = (await client.getSigningKey(header.kid)).getPublicKey();
        }
        const verifiedTokenData = jwt.verify(
          token,
          signingKey,
          verifyOptions
        );
        request.tokenPayload = verifiedTokenData;
        request.username = verifiedTokenData.email || verifiedTokenData.sub;
        const expectedRoles = new Set(validRoles);
        if (verifiedTokenData.groups) {
          const groupRoles = await Promise.allSettled(
            verifiedTokenData.groups.map(
              (x) => getGroupRoles(fastify2.dynamoClient, fastify2, x)
            )
          );
          for (const result of groupRoles) {
            if (result.status === "fulfilled") {
              for (const role of result.value) {
                userRoles.add(role);
              }
            } else {
              request.log.warn(`Failed to get group roles: ${result.reason}`);
            }
          }
        } else {
          if (verifiedTokenData.roles && fastify2.environmentConfig.AzureRoleMapping) {
            for (const group of verifiedTokenData.roles) {
              if (fastify2.environmentConfig["AzureRoleMapping"][group]) {
                for (const role of fastify2.environmentConfig["AzureRoleMapping"][group]) {
                  userRoles.add(role);
                }
              }
            }
          }
        }
        if (request.username) {
          try {
            const userAuth = await getUserRoles(
              fastify2.dynamoClient,
              fastify2,
              request.username
            );
            for (const role of userAuth) {
              userRoles.add(role);
            }
          } catch (e) {
            request.log.warn(
              `Failed to get user role mapping for ${request.username}: ${e}`
            );
          }
        }
        if (expectedRoles.size > 0 && intersection(userRoles, expectedRoles).size === 0) {
          throw new UnauthorizedError({
            message: "User does not have the privileges for this task."
          });
        }
      } catch (err) {
        if (err instanceof BaseError) {
          throw err;
        }
        if (err instanceof jwt.TokenExpiredError) {
          throw new UnauthenticatedError({
            message: "Token has expired."
          });
        }
        if (err instanceof Error) {
          request.log.error(`Failed to verify JWT: ${err.toString()} `);
          throw err;
        }
        throw new UnauthenticatedError({
          message: "Invalid token."
        });
      }
      request.log.info(`authenticated request from ${request.username} `);
      request.userRoles = userRoles;
      return userRoles;
    }
  );
};
var fastifyAuthPlugin = fp(authPlugin);
var auth_default = fastifyAuthPlugin;

// routes/protected.ts
import fastifyCaching from "@fastify/caching";
var protectedRoute = async (fastify2, _options) => {
  fastify2.register(fastifyCaching, {
    privacy: fastifyCaching.privacy.PRIVATE,
    serverExpiresIn: 0,
    expiresIn: 60 * 60 * 2
  });
  fastify2.get("/", async (request, reply) => {
    const roles = await fastify2.authorize(request, reply, []);
    reply.send({ username: request.username, roles: Array.from(roles) });
  });
};
var protected_default = protectedRoute;

// plugins/errorHandler.ts
import fp2 from "fastify-plugin";
var errorHandlerPlugin = fp2(async (fastify2) => {
  fastify2.setErrorHandler(
    (err, request, reply) => {
      let finalErr;
      if (err instanceof BaseError) {
        finalErr = err;
      } else if (err.validation || err.name === "BadRequestError") {
        finalErr = new ValidationError({
          message: err.message
        });
      }
      if (finalErr && finalErr instanceof BaseError) {
        request.log.error(
          { errId: finalErr.id, errName: finalErr.name },
          finalErr.toString()
        );
      } else if (err instanceof Error) {
        request.log.error(err);
        request.log.error(
          { errName: err.name, errMessage: err.message },
          "Native unhandled error: response sent to client."
        );
      } else {
        request.log.error(`Native unhandled error: response sent to client`);
      }
      if (!finalErr) {
        finalErr = new InternalServerError();
      }
      reply.status(finalErr.httpStatusCode).type("application/json").send({
        error: true,
        name: finalErr.name,
        id: finalErr.id,
        message: finalErr.message
      });
    }
  );
  fastify2.setNotFoundHandler((request) => {
    throw new NotFoundError({ endpointName: request.url });
  });
});
var errorHandler_default = errorHandlerPlugin;

// routes/events.ts
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// ../common/orgs.ts
var SIGList = [
  "SIGPwny",
  "SIGCHI",
  "GameBuilders",
  "SIGAIDA",
  "SIGGRAPH",
  "ICPC",
  "SIGMobile",
  "SIGMusic",
  "GLUG",
  "SIGNLL",
  "SIGma",
  "SIGQuantum",
  "SIGecom",
  "SIGPLAN",
  "SIGPolicy",
  "SIGARCH",
  "SIGRobotics",
  "SIGtricity"
];
var CommitteeList = [
  "Infrastructure Committee",
  "Social Committee",
  "Mentorship Committee",
  "Academic Committee",
  "Corporate Committee",
  "Marketing Committee"
];
var OrganizationList = ["ACM", ...SIGList, ...CommitteeList];

// routes/events.ts
import {
  DeleteItemCommand,
  GetItemCommand as GetItemCommand2,
  PutItemCommand,
  QueryCommand,
  ScanCommand
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall as unmarshall2 } from "@aws-sdk/util-dynamodb";
var import_moment_timezone2 = __toESM(require_moment_timezone_with_data_10_year_range(), 1);
import { randomUUID } from "crypto";

// functions/discord.ts
var import_moment_timezone = __toESM(require_moment_timezone_with_data_10_year_range(), 1);
import {
  Client,
  GatewayIntentBits,
  Events,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel
} from "discord.js";
var urlRegex = /https:\/\/[a-z0-9\.-]+\/calendar\?id=([a-f0-9-]+)/;
var updateDiscord = async (smClient, event, isDelete = false, logger) => {
  const secretApiConfig = await getSecretValue(smClient, genericConfig.ConfigSecretName) || {};
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  let payload = null;
  client.once(Events.ClientReady, async (readyClient) => {
    logger.info(`Logged in as ${readyClient.user.tag}`);
    const guildID = secretApiConfig["discord_guild_id"];
    const guild = await client.guilds.fetch(guildID?.toString() || "");
    const discordEvents = await guild.scheduledEvents.fetch();
    const snowflakeMeetingLookup = discordEvents.reduce(
      (o, event2) => {
        const { description: description2 } = event2;
        const url = (description2 || "").match(urlRegex);
        if (url) {
          const id2 = url[1];
          o[id2] = event2;
        }
        return o;
      },
      {}
    );
    const { id } = event;
    const existingMetadata = snowflakeMeetingLookup[id];
    if (isDelete) {
      if (existingMetadata) {
        await guild.scheduledEvents.delete(existingMetadata.id);
      } else {
        logger.warn(`Event with id ${id} not found in Discord`);
      }
      await client.destroy();
      return null;
    }
    const { title, description, start, end, location, host } = event;
    const dateStart = import_moment_timezone.default.tz(start, "America/Chicago").format("YYYY-MM-DD");
    const calendarURL = `https://www.acm.illinois.edu/calendar?id=${id}&date=${dateStart}`;
    const fullDescription = `${description}
${calendarURL}`;
    const fullTitle = title.toLowerCase().includes(host.toLowerCase()) ? title : `${host} - ${title}`;
    payload = {
      entityType: GuildScheduledEventEntityType.External,
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      name: fullTitle,
      description: fullDescription,
      scheduledStartTime: import_moment_timezone.default.tz(start, "America/Chicago").utc().toDate(),
      scheduledEndTime: end && import_moment_timezone.default.tz(end, "America/Chicago").utc().toDate(),
      image: existingMetadata?.coverImageURL({}) || void 0,
      entityMetadata: {
        location
      }
    };
    if (existingMetadata) {
      if (existingMetadata.creator?.bot !== true) {
        logger.warn(`Refusing to edit non-bot event "${title}"`);
      } else {
        await guild.scheduledEvents.edit(existingMetadata.id, payload);
      }
    } else {
      if (payload.scheduledStartTime < /* @__PURE__ */ new Date()) {
        logger.warn(`Refusing to create past event "${title}"`);
      } else {
        await guild.scheduledEvents.create(payload);
      }
    }
    await client.destroy();
    return payload;
  });
  const token = secretApiConfig["discord_bot_token"];
  if (!token) {
    logger.error("No Discord bot token found in secrets!");
    throw new DiscordEventError({});
  }
  client.login(token.toString());
  return payload;
};

// routes/events.ts
var repeatOptions = ["weekly", "biweekly"];
var EVENT_CACHE_SECONDS = 90;
var baseSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  start: z.string(),
  end: z.optional(z.string()),
  location: z.string(),
  locationLink: z.optional(z.string().url()),
  host: z.enum(OrganizationList),
  featured: z.boolean().default(false),
  paidEventId: z.optional(z.string().min(1))
});
var requestSchema = baseSchema.extend({
  repeats: z.optional(z.enum(repeatOptions)),
  repeatEnds: z.string().optional()
});
var postRequestSchema = requestSchema.refine(
  (data) => data.repeatEnds ? data.repeats !== void 0 : true,
  {
    message: "repeats is required when repeatEnds is defined"
  }
);
var responseJsonSchema = zodToJsonSchema(
  z.object({
    id: z.string(),
    resource: z.string()
  })
);
var getEventSchema = requestSchema.extend({
  id: z.string()
});
var getEventJsonSchema = zodToJsonSchema(getEventSchema);
var getEventsSchema = z.array(getEventSchema);
var eventsPlugin = async (fastify2, _options) => {
  fastify2.post(
    "/:id?",
    {
      schema: {
        response: { 201: responseJsonSchema }
      },
      preValidation: async (request, reply) => {
        await fastify2.zodValidateBody(request, reply, postRequestSchema);
      },
      onRequest: async (request, reply) => {
        await fastify2.authorize(request, reply, ["manage:events" /* EVENTS_MANAGER */]);
      }
    },
    async (request, reply) => {
      try {
        let originalEvent;
        const userProvidedId = request.params.id;
        const entryUUID = userProvidedId || randomUUID();
        if (userProvidedId) {
          const response = await fastify2.dynamoClient.send(
            new GetItemCommand2({
              TableName: genericConfig.EventsDynamoTableName,
              Key: { id: { S: userProvidedId } }
            })
          );
          originalEvent = response.Item;
          if (!originalEvent) {
            throw new ValidationError({
              message: `${userProvidedId} is not a valid event ID.`
            });
          }
        }
        const entry = {
          ...request.body,
          id: entryUUID,
          createdBy: request.username,
          createdAt: originalEvent ? originalEvent.createdAt || (/* @__PURE__ */ new Date()).toISOString() : (/* @__PURE__ */ new Date()).toISOString(),
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        await fastify2.dynamoClient.send(
          new PutItemCommand({
            TableName: genericConfig.EventsDynamoTableName,
            Item: marshall(entry)
          })
        );
        let verb = "created";
        if (userProvidedId && userProvidedId === entryUUID) {
          verb = "modified";
        }
        try {
          if (request.body.featured && !request.body.repeats) {
            await updateDiscord(
              fastify2.secretsManagerClient,
              entry,
              false,
              request.log
            );
          }
        } catch (e) {
          await fastify2.dynamoClient.send(
            new DeleteItemCommand({
              TableName: genericConfig.EventsDynamoTableName,
              Key: { id: { S: entryUUID } }
            })
          );
          if (userProvidedId) {
            await fastify2.dynamoClient.send(
              new PutItemCommand({
                TableName: genericConfig.EventsDynamoTableName,
                Item: originalEvent
              })
            );
          }
          if (e instanceof Error) {
            request.log.error(`Failed to publish event to Discord: ${e} `);
          }
          if (e instanceof BaseError) {
            throw e;
          }
          throw new DiscordEventError({});
        }
        reply.status(201).send({
          id: entryUUID,
          resource: `/api/v1/events/${entryUUID}`
        });
        request.log.info(
          { type: "audit", actor: request.username, target: entryUUID },
          `${verb} event "${entryUUID}"`
        );
      } catch (e) {
        if (e instanceof Error) {
          request.log.error("Failed to insert to DynamoDB: " + e.toString());
        }
        if (e instanceof BaseError) {
          throw e;
        }
        throw new DatabaseInsertError({
          message: "Failed to insert event to Dynamo table."
        });
      }
    }
  );
  fastify2.get(
    "/:id",
    {
      schema: {
        response: { 200: getEventJsonSchema }
      }
    },
    async (request, reply) => {
      const id = request.params.id;
      try {
        const response = await fastify2.dynamoClient.send(
          new QueryCommand({
            TableName: genericConfig.EventsDynamoTableName,
            KeyConditionExpression: "#id = :id",
            ExpressionAttributeNames: {
              "#id": "id"
            },
            ExpressionAttributeValues: marshall({ ":id": id })
          })
        );
        const items = response.Items?.map((item) => unmarshall2(item));
        if (items?.length !== 1) {
          throw new NotFoundError({
            endpointName: request.url
          });
        }
        reply.send(items[0]);
      } catch (e) {
        if (e instanceof BaseError) {
          throw e;
        }
        if (e instanceof Error) {
          request.log.error("Failed to get from DynamoDB: " + e.toString());
        }
        throw new DatabaseFetchError({
          message: "Failed to get event from Dynamo table."
        });
      }
    }
  );
  fastify2.delete(
    "/:id",
    {
      schema: {
        response: { 201: responseJsonSchema }
      },
      onRequest: async (request, reply) => {
        await fastify2.authorize(request, reply, ["manage:events" /* EVENTS_MANAGER */]);
      }
    },
    async (request, reply) => {
      const id = request.params.id;
      try {
        await fastify2.dynamoClient.send(
          new DeleteItemCommand({
            TableName: genericConfig.EventsDynamoTableName,
            Key: marshall({ id })
          })
        );
        await updateDiscord(
          fastify2.secretsManagerClient,
          { id },
          true,
          request.log
        );
        reply.status(201).send({
          id,
          resource: `/api/v1/events/${id}`
        });
      } catch (e) {
        if (e instanceof Error) {
          request.log.error("Failed to delete from DynamoDB: " + e.toString());
        }
        throw new DatabaseInsertError({
          message: "Failed to delete event from Dynamo table."
        });
      }
      request.log.info(
        { type: "audit", actor: request.username, target: id },
        `deleted event "${id}"`
      );
    }
  );
  fastify2.get(
    "/",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            upcomingOnly: { type: "boolean" }
          }
        },
        response: { 200: getEventsSchema }
      }
    },
    async (request, reply) => {
      const upcomingOnly = request.query?.upcomingOnly || false;
      const cachedResponse = fastify2.nodeCache.get(
        `events-upcoming_only=${upcomingOnly}`
      );
      if (cachedResponse) {
        reply.header(
          "cache-control",
          "public, max-age=7200, stale-while-revalidate=900, stale-if-error=86400"
        ).header("acm-cache-status", "hit").send(cachedResponse);
      }
      try {
        const response = await fastify2.dynamoClient.send(
          new ScanCommand({ TableName: genericConfig.EventsDynamoTableName })
        );
        const items = response.Items?.map((item) => unmarshall2(item));
        const currentTimeChicago = (0, import_moment_timezone2.default)().tz("America/Chicago");
        let parsedItems = getEventsSchema.parse(items);
        if (upcomingOnly) {
          parsedItems = parsedItems.filter((item) => {
            try {
              if (item.repeats && !item.repeatEnds) {
                return true;
              }
              if (!item.repeats) {
                const end = item.end || item.start;
                const momentEnds = import_moment_timezone2.default.tz(end, "America/Chicago");
                const diffTime2 = currentTimeChicago.diff(momentEnds);
                return Boolean(
                  diffTime2 <= genericConfig.UpcomingEventThresholdSeconds
                );
              }
              const momentRepeatEnds = import_moment_timezone2.default.tz(
                item.repeatEnds,
                "America/Chicago"
              );
              const diffTime = currentTimeChicago.diff(momentRepeatEnds);
              return Boolean(
                diffTime <= genericConfig.UpcomingEventThresholdSeconds
              );
            } catch (e) {
              request.log.warn(
                `Could not compute upcoming event status for event ${item.title}: ${e instanceof Error ? e.toString() : e} `
              );
              return false;
            }
          });
        }
        fastify2.nodeCache.set(
          `events-upcoming_only=${upcomingOnly}`,
          parsedItems,
          EVENT_CACHE_SECONDS
        );
        reply.header(
          "cache-control",
          "public, max-age=7200, stale-while-revalidate=900, stale-if-error=86400"
        ).header("acm-cache-status", "miss").send(parsedItems);
      } catch (e) {
        if (e instanceof Error) {
          request.log.error("Failed to get from DynamoDB: " + e.toString());
        } else {
          request.log.error(`Failed to get from DynamoDB.${e} `);
        }
        throw new DatabaseFetchError({
          message: "Failed to get events from Dynamo table."
        });
      }
    }
  );
};
var events_default = eventsPlugin;

// index.ts
import cors from "@fastify/cors";

// plugins/validate.ts
import fp3 from "fastify-plugin";
import { ZodError } from "zod";
import { fromError } from "zod-validation-error";
var zodValidationPlugin = async (fastify2, _options) => {
  fastify2.decorate(
    "zodValidateBody",
    async function(request, _reply, zodSchema) {
      try {
        await zodSchema.parseAsync(request.body || {});
      } catch (e) {
        if (e instanceof ZodError) {
          throw new ValidationError({
            message: fromError(e).toString().replace("Validation error: ", "")
          });
        } else if (e instanceof Error) {
          request.log.error(`Error validating request body: ${e.toString()}`);
          throw new InternalServerError({
            message: "Could not validate request body."
          });
        }
        throw e;
      }
    }
  );
};
var fastifyZodValidationPlugin = fp3(zodValidationPlugin);
var validate_default = fastifyZodValidationPlugin;

// routes/organizations.ts
import fastifyCaching2 from "@fastify/caching";
var organizationsPlugin = async (fastify2, _options) => {
  fastify2.register(fastifyCaching2, {
    privacy: fastifyCaching2.privacy.PUBLIC,
    serverExpiresIn: 60 * 60 * 4,
    expiresIn: 60 * 60 * 4
  });
  fastify2.get("/", {}, async (request, reply) => {
    reply.send(OrganizationList);
  });
};
var organizations_default = organizationsPlugin;

// routes/ics.ts
import {
  QueryCommand as QueryCommand2,
  ScanCommand as ScanCommand2
} from "@aws-sdk/client-dynamodb";
import { unmarshall as unmarshall3 } from "@aws-sdk/util-dynamodb";
import ical, {
  ICalCalendarMethod,
  ICalEventRepeatingFreq
} from "ical-generator";
import moment3 from "moment";
import { getVtimezoneComponent } from "@touch4it/ical-timezones";
var repeatingIcalMap = {
  weekly: { freq: ICalEventRepeatingFreq.WEEKLY },
  biweekly: { freq: ICalEventRepeatingFreq.WEEKLY, interval: 2 }
};
function generateHostName(host) {
  if (host == "ACM" || !host) {
    return "ACM@UIUC";
  }
  if (host.includes("ACM")) {
    return host;
  }
  return `ACM@UIUC ${host}`;
}
var icalPlugin = async (fastify2, _options) => {
  fastify2.get("/:host?", async (request, reply) => {
    const host = request.params.host;
    let queryParams = {
      TableName: genericConfig.EventsDynamoTableName
    };
    let response;
    if (host) {
      if (!OrganizationList.includes(host)) {
        throw new ValidationError({
          message: `Invalid host parameter "${host}" in path.`
        });
      }
      queryParams = {
        ...queryParams
      };
      response = await fastify2.dynamoClient.send(
        new QueryCommand2({
          ...queryParams,
          ExpressionAttributeValues: {
            ":host": {
              S: host
            }
          },
          KeyConditionExpression: "host = :host",
          IndexName: "HostIndex"
        })
      );
    } else {
      response = await fastify2.dynamoClient.send(new ScanCommand2(queryParams));
    }
    const dynamoItems = response.Items ? response.Items.map((x) => unmarshall3(x)) : null;
    if (!dynamoItems) {
      throw new NotFoundError({
        endpointName: host ? `/api/v1/ical/${host}` : "/api/v1/ical"
      });
    }
    let calendarName = host && host.includes("ACM") ? `${host} Events` : `ACM@UIUC - ${host} Events`;
    if (host == "ACM") {
      calendarName = "ACM@UIUC - Major Events";
    }
    if (!host) {
      calendarName = "ACM@UIUC - All Events";
    }
    const calendar = ical({ name: calendarName });
    calendar.timezone({
      name: "America/Chicago",
      generator: getVtimezoneComponent
    });
    calendar.method(ICalCalendarMethod.PUBLISH);
    for (const rawEvent of dynamoItems) {
      let event = calendar.createEvent({
        start: moment3.tz(rawEvent.start, "America/Chicago"),
        end: rawEvent.end ? moment3.tz(rawEvent.end, "America/Chicago") : moment3.tz(rawEvent.start, "America/Chicago"),
        summary: rawEvent.title,
        description: rawEvent.locationLink ? `Host: ${rawEvent.host}
Google Maps Link: ${rawEvent.locationLink}

` + rawEvent.description : `Host: ${rawEvent.host}

` + rawEvent.description,
        timezone: "America/Chicago",
        organizer: generateHostName(host),
        id: rawEvent.id
      });
      if (rawEvent.repeats) {
        if (rawEvent.repeatEnds) {
          event = event.repeating({
            ...repeatingIcalMap[rawEvent.repeats],
            until: moment3.tz(rawEvent.repeatEnds, "America/Chicago")
          });
        } else {
          event.repeating(
            repeatingIcalMap[rawEvent.repeats]
          );
        }
      }
      if (rawEvent.location) {
        event = event.location({
          title: rawEvent.location
        });
      }
    }
    reply.headers({
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="calendar.ics"'
    }).send(calendar.toString());
  });
};
var ics_default = icalPlugin;

// routes/vending.ts
import { z as z3 } from "zod";
var postSchema = z3.object({
  name: z3.string().min(1),
  imageUrl: z3.string().url(),
  price: z3.number().min(0)
});
var vendingPlugin = async (fastify2, _options) => {
  fastify2.get("/items", async (request, reply) => {
    reply.send({
      items: [
        {
          slots: ["A1"],
          id: "ronitpic",
          name: "A Picture of Ronit",
          image_url: "https://acm-brand-images.s3.amazonaws.com/ronit.jpeg",
          price: 999,
          calories: null,
          fat: null,
          carbs: null,
          fiber: null,
          sugar: null,
          protein: null,
          quantity: 100,
          locations: null
        }
      ]
    });
  });
  fastify2.post(
    "/items",
    {
      preValidation: async (request, reply) => {
        await fastify2.zodValidateBody(request, reply, postSchema);
      }
    },
    async (request, reply) => {
      reply.send({ status: "Not implemented." });
    }
  );
};
var vending_default = vendingPlugin;

// index.ts
import * as dotenv from "dotenv";

// routes/iam.ts
import { zodToJsonSchema as zodToJsonSchema2 } from "zod-to-json-schema";

// functions/entraId.ts
import { ConfidentialClientApplication } from "@azure/msal-node";

// functions/cache.ts
import {
  PutItemCommand as PutItemCommand2,
  QueryCommand as QueryCommand3
} from "@aws-sdk/client-dynamodb";
import { marshall as marshall2, unmarshall as unmarshall4 } from "@aws-sdk/util-dynamodb";
async function getItemFromCache(dynamoClient, key) {
  const currentTime = Math.floor(Date.now() / 1e3);
  const { Items } = await dynamoClient.send(
    new QueryCommand3({
      TableName: genericConfig.CacheDynamoTableName,
      KeyConditionExpression: "#pk = :pk",
      FilterExpression: "#ea > :ea",
      ExpressionAttributeNames: {
        "#pk": "primaryKey",
        "#ea": "expireAt"
      },
      ExpressionAttributeValues: marshall2({
        ":pk": key,
        ":ea": currentTime
      })
    })
  );
  if (!Items || Items.length == 0) {
    return null;
  }
  const item = unmarshall4(Items[0]);
  return item;
}
async function insertItemIntoCache(dynamoClient, key, value, expireAt) {
  const item = {
    primaryKey: key,
    expireAt: Math.floor(expireAt.getTime() / 1e3),
    ...value
  };
  await dynamoClient.send(
    new PutItemCommand2({
      TableName: genericConfig.CacheDynamoTableName,
      Item: marshall2(item)
    })
  );
}

// ../common/types/iam.ts
import { z as z4 } from "zod";
var invitePostRequestSchema = z4.object({
  emails: z4.array(z4.string())
});
var groupMappingCreatePostSchema = z4.object({
  roles: z4.union([
    z4.array(z4.nativeEnum(AppRoles)).min(1).refine((items) => new Set(items).size === items.length, {
      message: "All roles must be unique, no duplicate values allowed"
    }),
    z4.tuple([z4.literal("all")])
  ])
});
var entraActionResponseSchema = z4.object({
  success: z4.array(z4.object({ email: z4.string() })).optional(),
  failure: z4.array(z4.object({ email: z4.string(), message: z4.string() })).optional()
});
var groupModificationPatchSchema = z4.object({
  add: z4.array(z4.string()),
  remove: z4.array(z4.string())
});
var entraGroupMembershipListResponse = z4.array(
  z4.object({
    name: z4.string(),
    email: z4.string()
  })
);

// functions/entraId.ts
function validateGroupId(groupId) {
  const groupIdPattern = /^[a-zA-Z0-9-]+$/;
  return groupIdPattern.test(groupId);
}
async function getEntraIdToken(clients, clientId, scopes = ["https://graph.microsoft.com/.default"]) {
  const secretApiConfig = await getSecretValue(clients.smClient, genericConfig.ConfigSecretName) || {};
  if (!secretApiConfig.entra_id_private_key || !secretApiConfig.entra_id_thumbprint) {
    throw new InternalServerError({
      message: "Could not find Entra ID credentials."
    });
  }
  const decodedPrivateKey = Buffer.from(
    secretApiConfig.entra_id_private_key,
    "base64"
  ).toString("utf8");
  const cachedToken = await getItemFromCache(
    clients.dynamoClient,
    "entra_id_access_token"
  );
  if (cachedToken) {
    return cachedToken["token"];
  }
  const config2 = {
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${genericConfig.EntraTenantId}`,
      clientCertificate: {
        thumbprint: secretApiConfig.entra_id_thumbprint || "",
        privateKey: decodedPrivateKey
      }
    }
  };
  const cca = new ConfidentialClientApplication(config2);
  try {
    const result = await cca.acquireTokenByClientCredential({
      scopes
    });
    const date = result?.expiresOn;
    if (!date) {
      throw new InternalServerError({
        message: `Failed to acquire token: token has no expiry field.`
      });
    }
    date.setTime(date.getTime() - 3e4);
    if (result?.accessToken) {
      await insertItemIntoCache(
        clients.dynamoClient,
        "entra_id_access_token",
        { token: result?.accessToken },
        date
      );
    }
    return result?.accessToken ?? null;
  } catch (error) {
    throw new InternalServerError({
      message: `Failed to acquire token: ${error}`
    });
  }
}
async function addToTenant(token, email) {
  email = email.toLowerCase().replace(/\s/g, "");
  if (!email.endsWith("@illinois.edu")) {
    throw new EntraInvitationError({
      email,
      message: "User's domain must be illinois.edu to be invited."
    });
  }
  try {
    const body = {
      invitedUserEmailAddress: email,
      inviteRedirectUrl: "https://acm.illinois.edu"
    };
    const url = "https://graph.microsoft.com/v1.0/invitations";
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new EntraInvitationError({
        message: errorData.error?.message || response.statusText,
        email
      });
    }
    return { success: true, email };
  } catch (error) {
    if (error instanceof EntraInvitationError) {
      throw error;
    }
    throw new EntraInvitationError({
      message: error instanceof Error ? error.message : String(error),
      email
    });
  }
}
async function resolveEmailToOid(token, email) {
  email = email.toLowerCase().replace(/\s/g, "");
  const url = `https://graph.microsoft.com/v1.0/users?$filter=mail eq '${email}'`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData?.error?.message ?? response.statusText);
  }
  const data = await response.json();
  if (!data.value || data.value.length === 0) {
    throw new Error(`No user found with email: ${email}`);
  }
  return data.value[0].id;
}
async function modifyGroup(token, email, group, action) {
  email = email.toLowerCase().replace(/\s/g, "");
  if (!email.endsWith("@illinois.edu")) {
    throw new EntraGroupError({
      group,
      message: "User's domain must be illinois.edu to be added to the group."
    });
  }
  const paidMemberRequiredGroups = [
    execCouncilGroupId,
    execCouncilTestingGroupId,
    officersGroupId,
    officersGroupTestingId
  ];
  if (paidMemberRequiredGroups.includes(group) && action === 0 /* ADD */) {
    const netId = email.split("@")[0];
    const response = await fetch(
      `https://membership.acm.illinois.edu/api/v1/checkMembership?netId=${netId}`
    );
    const membershipStatus = await response.json();
    if (!membershipStatus["isPaidMember"]) {
      throw new EntraGroupError({
        message: `${netId} is not a paid member. This group requires that all members are paid members.`,
        group
      });
    }
  }
  try {
    const oid = await resolveEmailToOid(token, email);
    const methodMapper = {
      [0 /* ADD */]: "POST",
      [1 /* REMOVE */]: "DELETE"
    };
    const urlMapper = {
      [0 /* ADD */]: `https://graph.microsoft.com/v1.0/groups/${group}/members/$ref`,
      [1 /* REMOVE */]: `https://graph.microsoft.com/v1.0/groups/${group}/members/${oid}/$ref`
    };
    const url = urlMapper[action];
    const body = {
      "@odata.id": `https://graph.microsoft.com/v1.0/directoryObjects/${oid}`
    };
    const response = await fetch(url, {
      method: methodMapper[action],
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const errorData = await response.json();
      if (errorData?.error?.message === "One or more added object references already exist for the following modified properties: 'members'.") {
        return true;
      }
      throw new EntraGroupError({
        message: errorData?.error?.message ?? response.statusText,
        group
      });
    }
    return true;
  } catch (error) {
    if (error instanceof EntraGroupError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message) {
      throw new EntraGroupError({
        message,
        group
      });
    }
  }
  return false;
}
async function listGroupMembers(token, group) {
  if (!validateGroupId(group)) {
    throw new EntraGroupError({
      message: "Invalid group ID format",
      group
    });
  }
  try {
    const url = `https://graph.microsoft.com/v1.0/groups/${group}/members`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new EntraGroupError({
        message: errorData?.error?.message ?? response.statusText,
        group
      });
    }
    const data = await response.json();
    const members = data.value.map((member) => ({
      name: member.displayName ?? "",
      email: member.mail ?? ""
    }));
    return members;
  } catch (error) {
    if (error instanceof EntraGroupError) {
      throw error;
    }
    throw new EntraGroupError({
      message: error instanceof Error ? error.message : String(error),
      group
    });
  }
}

// routes/iam.ts
import { PutItemCommand as PutItemCommand3 } from "@aws-sdk/client-dynamodb";
import { marshall as marshall3 } from "@aws-sdk/util-dynamodb";
var iamRoutes = async (fastify2, _options) => {
  fastify2.get(
    "/groups/:groupId/roles",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            groupId: {
              type: "string"
            }
          }
        }
      },
      onRequest: async (request, reply) => {
        await fastify2.authorize(request, reply, ["admin:iam" /* IAM_ADMIN */]);
      }
    },
    async (request, reply) => {
      try {
        const groupId = request.params.groupId;
        const roles = await getGroupRoles(
          fastify2.dynamoClient,
          fastify2,
          groupId
        );
        return reply.send(roles);
      } catch (e) {
        if (e instanceof BaseError) {
          throw e;
        }
        request.log.error(e);
        throw new DatabaseFetchError({
          message: "An error occurred finding the group role mapping."
        });
      }
    }
  );
  fastify2.post(
    "/groups/:groupId/roles",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            groupId: {
              type: "string"
            }
          }
        }
      },
      preValidation: async (request, reply) => {
        await fastify2.zodValidateBody(
          request,
          reply,
          groupMappingCreatePostSchema
        );
      },
      onRequest: async (request, reply) => {
        await fastify2.authorize(request, reply, ["admin:iam" /* IAM_ADMIN */]);
      }
    },
    async (request, reply) => {
      const groupId = request.params.groupId;
      try {
        const timestamp = (/* @__PURE__ */ new Date()).toISOString();
        const command = new PutItemCommand3({
          TableName: `${genericConfig.IAMTablePrefix}-grouproles`,
          Item: marshall3({
            groupUuid: groupId,
            roles: request.body.roles,
            createdAt: timestamp
          })
        });
        await fastify2.dynamoClient.send(command);
        fastify2.nodeCache.set(
          `grouproles-${groupId}`,
          request.body.roles,
          AUTH_DECISION_CACHE_SECONDS
        );
      } catch (e) {
        fastify2.nodeCache.del(`grouproles-${groupId}`);
        if (e instanceof BaseError) {
          throw e;
        }
        request.log.error(e);
        throw new DatabaseInsertError({
          message: "Could not create group role mapping."
        });
      }
      reply.send({ message: "OK" });
      request.log.info(
        { type: "audit", actor: request.username, target: groupId },
        `set target roles to ${request.body.roles.toString()}`
      );
    }
  );
  fastify2.post(
    "/inviteUsers",
    {
      schema: {
        response: { 202: zodToJsonSchema2(entraActionResponseSchema) }
      },
      preValidation: async (request, reply) => {
        await fastify2.zodValidateBody(request, reply, invitePostRequestSchema);
      },
      onRequest: async (request, reply) => {
        await fastify2.authorize(request, reply, ["invite:iam" /* IAM_INVITE_ONLY */]);
      }
    },
    async (request, reply) => {
      const emails = request.body.emails;
      const entraIdToken = await getEntraIdToken(
        {
          smClient: fastify2.secretsManagerClient,
          dynamoClient: fastify2.dynamoClient
        },
        fastify2.environmentConfig.AadValidClientId
      );
      if (!entraIdToken) {
        throw new InternalServerError({
          message: "Could not get Entra ID token to perform task."
        });
      }
      const response = {
        success: [],
        failure: []
      };
      const results = await Promise.allSettled(
        emails.map((email) => addToTenant(entraIdToken, email))
      );
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === "fulfilled") {
          request.log.info(
            { type: "audit", actor: request.username, target: emails[i] },
            "invited user to Entra ID tenant."
          );
          response.success.push({ email: emails[i] });
        } else {
          request.log.info(
            { type: "audit", actor: request.username, target: emails[i] },
            "failed to invite user to Entra ID tenant."
          );
          if (result.reason instanceof EntraInvitationError) {
            response.failure.push({
              email: emails[i],
              message: result.reason.message
            });
          } else {
            response.failure.push({
              email: emails[i],
              message: "An unknown error occurred."
            });
          }
        }
      }
      reply.status(202).send(response);
    }
  );
  fastify2.patch(
    "/groups/:groupId",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            groupId: {
              type: "string"
            }
          }
        }
      },
      preValidation: async (request, reply) => {
        await fastify2.zodValidateBody(
          request,
          reply,
          groupModificationPatchSchema
        );
      },
      onRequest: async (request, reply) => {
        await fastify2.authorize(request, reply, ["admin:iam" /* IAM_ADMIN */]);
      }
    },
    async (request, reply) => {
      const groupId = request.params.groupId;
      if (!groupId || groupId === "") {
        throw new NotFoundError({
          endpointName: request.url
        });
      }
      if (genericConfig.ProtectedEntraIDGroups.includes(groupId)) {
        throw new EntraGroupError({
          code: 403,
          message: "This group is protected and cannot be modified by this service. You must log into Entra ID directly to modify this group.",
          group: groupId
        });
      }
      const entraIdToken = await getEntraIdToken(
        {
          smClient: fastify2.secretsManagerClient,
          dynamoClient: fastify2.dynamoClient
        },
        fastify2.environmentConfig.AadValidClientId
      );
      const addResults = await Promise.allSettled(
        request.body.add.map(
          (email) => modifyGroup(entraIdToken, email, groupId, 0 /* ADD */)
        )
      );
      const removeResults = await Promise.allSettled(
        request.body.remove.map(
          (email) => modifyGroup(entraIdToken, email, groupId, 1 /* REMOVE */)
        )
      );
      const response = {
        success: [],
        failure: []
      };
      for (let i = 0; i < addResults.length; i++) {
        const result = addResults[i];
        if (result.status === "fulfilled") {
          response.success.push({ email: request.body.add[i] });
          request.log.info(
            {
              type: "audit",
              actor: request.username,
              target: request.body.add[i]
            },
            `added target to group ID ${groupId}`
          );
        } else {
          request.log.info(
            {
              type: "audit",
              actor: request.username,
              target: request.body.add[i]
            },
            `failed to add target to group ID ${groupId}`
          );
          if (result.reason instanceof EntraGroupError) {
            response.failure.push({
              email: request.body.add[i],
              message: result.reason.message
            });
          } else {
            response.failure.push({
              email: request.body.add[i],
              message: "An unknown error occurred."
            });
          }
        }
      }
      for (let i = 0; i < removeResults.length; i++) {
        const result = removeResults[i];
        if (result.status === "fulfilled") {
          response.success.push({ email: request.body.remove[i] });
          request.log.info(
            {
              type: "audit",
              actor: request.username,
              target: request.body.remove[i]
            },
            `removed target from group ID ${groupId}`
          );
        } else {
          request.log.info(
            {
              type: "audit",
              actor: request.username,
              target: request.body.add[i]
            },
            `failed to remove target from group ID ${groupId}`
          );
          if (result.reason instanceof EntraGroupError) {
            response.failure.push({
              email: request.body.add[i],
              message: result.reason.message
            });
          } else {
            response.failure.push({
              email: request.body.add[i],
              message: "An unknown error occurred."
            });
          }
        }
      }
      reply.status(202).send(response);
    }
  );
  fastify2.get(
    "/groups/:groupId",
    {
      schema: {
        response: { 200: zodToJsonSchema2(entraGroupMembershipListResponse) },
        querystring: {
          type: "object",
          properties: {
            groupId: {
              type: "string"
            }
          }
        }
      },
      onRequest: async (request, reply) => {
        await fastify2.authorize(request, reply, ["admin:iam" /* IAM_ADMIN */]);
      }
    },
    async (request, reply) => {
      const groupId = request.params.groupId;
      if (!groupId || groupId === "") {
        throw new NotFoundError({
          endpointName: request.url
        });
      }
      if (genericConfig.ProtectedEntraIDGroups.includes(groupId)) {
        throw new EntraGroupError({
          code: 403,
          message: "This group is protected and cannot be read by this service. You must log into Entra ID directly to read this group.",
          group: groupId
        });
      }
      const entraIdToken = await getEntraIdToken(
        {
          smClient: fastify2.secretsManagerClient,
          dynamoClient: fastify2.dynamoClient
        },
        fastify2.environmentConfig.AadValidClientId
      );
      const response = await listGroupMembers(entraIdToken, groupId);
      reply.status(200).send(response);
    }
  );
};
var iam_default = iamRoutes;

// routes/tickets.ts
import { z as z6 } from "zod";
import {
  QueryCommand as QueryCommand4,
  ScanCommand as ScanCommand3,
  UpdateItemCommand
} from "@aws-sdk/client-dynamodb";
import { unmarshall as unmarshall5 } from "@aws-sdk/util-dynamodb";

// functions/validation.ts
import { z as z5 } from "zod";
function validateEmail(email) {
  const emailSchema = z5.string().email();
  const result = emailSchema.safeParse(email);
  return result.success;
}

// routes/tickets.ts
import { zodToJsonSchema as zodToJsonSchema3 } from "zod-to-json-schema";
var postMerchSchema = z6.object({
  type: z6.literal("merch"),
  email: z6.string().email(),
  stripePi: z6.string().min(1)
});
var postTicketSchema = z6.object({
  type: z6.literal("ticket"),
  ticketId: z6.string().min(1)
});
var purchaseSchema = z6.object({
  email: z6.string().email(),
  productId: z6.string(),
  quantity: z6.number().int().positive(),
  size: z6.string().optional()
});
var ticketEntryZod = z6.object({
  valid: z6.boolean(),
  type: z6.enum(["merch", "ticket"]),
  ticketId: z6.string().min(1),
  purchaserData: purchaseSchema
});
var ticketInfoEntryZod = ticketEntryZod.extend({
  refunded: z6.boolean(),
  fulfilled: z6.boolean()
});
var responseJsonSchema2 = zodToJsonSchema3(ticketEntryZod);
var getTicketsResponseJsonSchema = zodToJsonSchema3(
  z6.object({
    tickets: z6.array(ticketInfoEntryZod)
  })
);
var baseItemMetadata = z6.object({
  itemId: z6.string().min(1),
  itemName: z6.string().min(1),
  itemSalesActive: z6.union([z6.date(), z6.literal(false)]),
  priceDollars: z6.object({
    member: z6.number().min(0),
    nonMember: z6.number().min(0)
  })
});
var ticketingItemMetadata = baseItemMetadata.extend({
  eventCapacity: z6.number(),
  ticketsSold: z6.number()
});
var listMerchItemsResponseJsonSchema = zodToJsonSchema3(
  z6.object({
    merch: z6.array(baseItemMetadata),
    tickets: z6.array(ticketingItemMetadata)
  })
);
var postSchema2 = z6.union([postMerchSchema, postTicketSchema]);
var ticketsPlugin = async (fastify2, _options) => {
  fastify2.get(
    "/",
    {
      schema: {
        response: {
          200: listMerchItemsResponseJsonSchema
        }
      },
      onRequest: async (request, reply) => {
        await fastify2.authorize(request, reply, [
          "manage:tickets" /* TICKETS_MANAGER */,
          "scan:tickets" /* TICKETS_SCANNER */
        ]);
      }
    },
    async (request, reply) => {
      let isTicketingManager = true;
      try {
        await fastify2.authorize(request, reply, ["manage:tickets" /* TICKETS_MANAGER */]);
      } catch {
        isTicketingManager = false;
      }
      const merchCommand = new ScanCommand3({
        TableName: genericConfig.MerchStoreMetadataTableName,
        ProjectionExpression: "item_id, item_name, item_sales_active_utc, item_price"
      });
      const merchItems = [];
      const response = await fastify2.dynamoClient.send(merchCommand);
      const now2 = /* @__PURE__ */ new Date();
      if (response.Items) {
        for (const item of response.Items.map((x) => unmarshall5(x))) {
          const itemDate = new Date(parseInt(item.item_sales_active_utc, 10));
          if (!isTicketingManager && (item.item_sales_active_utc === -1 || itemDate > now2)) {
            continue;
          }
          const memberPrice = parseInt(item.item_price?.paid, 10) || 0;
          const nonMemberPrice = parseInt(item.item_price?.others, 10) || 0;
          merchItems.push({
            itemId: item.item_id,
            itemName: item.item_name,
            itemSalesActive: item.item_sales_active_utc === -1 ? false : itemDate,
            priceDollars: {
              member: memberPrice,
              nonMember: nonMemberPrice
            }
          });
        }
      }
      const ticketCommand = new ScanCommand3({
        TableName: genericConfig.TicketMetadataTableName,
        ProjectionExpression: "event_id, event_name, event_sales_active_utc, event_capacity, tickets_sold, eventCost"
      });
      const ticketItems = [];
      const ticketResponse = await fastify2.dynamoClient.send(ticketCommand);
      if (ticketResponse.Items) {
        for (const item of ticketResponse.Items.map((x) => unmarshall5(x))) {
          const itemDate = new Date(parseInt(item.event_sales_active_utc, 10));
          if (!isTicketingManager && (item.event_sales_active_utc === -1 || itemDate > now2)) {
            continue;
          }
          const memberPrice = parseInt(item.eventCost?.paid, 10) || 0;
          const nonMemberPrice = parseInt(item.eventCost?.others, 10) || 0;
          ticketItems.push({
            itemId: item.event_id,
            itemName: item.event_name,
            itemSalesActive: item.event_sales_active_utc === -1 ? false : new Date(parseInt(item.event_sales_active_utc, 10)),
            eventCapacity: item.event_capacity,
            ticketsSold: item.tickets_sold,
            priceDollars: {
              member: memberPrice,
              nonMember: nonMemberPrice
            }
          });
        }
      }
      reply.send({ merch: merchItems, tickets: ticketItems });
    }
  );
  fastify2.get(
    "/:eventId",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["merch", "ticket"]
            }
          }
        },
        response: {
          200: getTicketsResponseJsonSchema
        }
      },
      onRequest: async (request, reply) => {
        await fastify2.authorize(request, reply, ["manage:tickets" /* TICKETS_MANAGER */]);
      }
    },
    async (request, reply) => {
      const eventId = request.params.eventId;
      const eventType = request.query?.type;
      const issuedTickets = [];
      switch (eventType) {
        case "merch":
          const command = new QueryCommand4({
            TableName: genericConfig.MerchStorePurchasesTableName,
            IndexName: "ItemIdIndexAll",
            KeyConditionExpression: "item_id = :itemId",
            ExpressionAttributeValues: {
              ":itemId": { S: eventId }
            }
          });
          const response2 = await fastify2.dynamoClient.send(command);
          if (!response2.Items) {
            throw new NotFoundError({
              endpointName: `/api/v1/tickets/${eventId}`
            });
          }
          for (const item of response2.Items) {
            const unmarshalled = unmarshall5(item);
            issuedTickets.push({
              type: "merch",
              valid: true,
              ticketId: unmarshalled["stripe_pi"],
              refunded: unmarshalled["refunded"],
              fulfilled: unmarshalled["fulfilled"],
              purchaserData: {
                email: unmarshalled["email"],
                productId: eventId,
                quantity: unmarshalled["quantity"],
                size: unmarshalled["size"]
              }
            });
          }
          break;
        default:
          throw new NotSupportedError({
            message: `Retrieving tickets currently only supported on type "merch"!`
          });
      }
      const response = { tickets: issuedTickets };
      return reply.send(response);
    }
  );
  fastify2.post(
    "/checkIn",
    {
      schema: {
        response: { 200: responseJsonSchema2 }
      },
      preValidation: async (request, reply) => {
        await fastify2.zodValidateBody(request, reply, postSchema2);
      },
      onRequest: async (request, reply) => {
        await fastify2.authorize(request, reply, ["scan:tickets" /* TICKETS_SCANNER */]);
      }
    },
    async (request, reply) => {
      let command;
      let ticketId;
      if (!request.username) {
        throw new UnauthenticatedError({
          message: "Could not find username."
        });
      }
      switch (request.body.type) {
        case "merch":
          ticketId = request.body.stripePi;
          command = new UpdateItemCommand({
            TableName: genericConfig.MerchStorePurchasesTableName,
            Key: {
              stripe_pi: { S: ticketId }
            },
            UpdateExpression: "SET fulfilled = :true_val",
            ConditionExpression: "#email = :email_val",
            ExpressionAttributeNames: {
              "#email": "email"
            },
            ExpressionAttributeValues: {
              ":true_val": { BOOL: true },
              ":email_val": { S: request.body.email }
            },
            ReturnValues: "ALL_OLD"
          });
          break;
        case "ticket":
          ticketId = request.body.ticketId;
          command = new UpdateItemCommand({
            TableName: genericConfig.TicketPurchasesTableName,
            Key: {
              ticket_id: { S: ticketId }
            },
            UpdateExpression: "SET #used = :trueValue",
            ExpressionAttributeNames: {
              "#used": "used"
            },
            ExpressionAttributeValues: {
              ":trueValue": { BOOL: true }
            },
            ReturnValues: "ALL_OLD"
          });
          break;
        default:
          throw new ValidationError({
            message: `Unknown verification type!`
          });
      }
      let purchaserData;
      try {
        const ticketEntry = await fastify2.dynamoClient.send(command);
        if (!ticketEntry.Attributes) {
          throw new DatabaseFetchError({
            message: "Could not find ticket data"
          });
        }
        const attributes = unmarshall5(ticketEntry.Attributes);
        if (attributes["refunded"]) {
          throw new TicketNotValidError({
            message: "Ticket was already refunded."
          });
        }
        if (attributes["used"] || attributes["fulfilled"]) {
          throw new TicketNotValidError({
            message: "Ticket has already been used."
          });
        }
        if (request.body.type === "ticket") {
          const rawData = attributes["ticketholder_netid"];
          const isEmail = validateEmail(attributes["ticketholder_netid"]);
          purchaserData = {
            email: isEmail ? rawData : `${rawData}@illinois.edu`,
            productId: attributes["event_id"],
            quantity: 1
          };
        } else {
          purchaserData = {
            email: attributes["email"],
            productId: attributes["item_id"],
            quantity: attributes["quantity"],
            size: attributes["size"]
          };
        }
      } catch (e) {
        if (!(e instanceof Error)) {
          throw e;
        }
        request.log.error(e);
        if (e instanceof BaseError) {
          throw e;
        }
        if (e.name === "ConditionalCheckFailedException") {
          throw new TicketNotFoundError({
            message: "Ticket does not exist"
          });
        }
        throw new DatabaseFetchError({
          message: "Could not set ticket to used - database operation failed"
        });
      }
      const response = {
        valid: true,
        type: request.body.type,
        ticketId,
        purchaserData
      };
      switch (request.body.type) {
        case "merch":
          ticketId = request.body.stripePi;
          command = new UpdateItemCommand({
            TableName: genericConfig.MerchStorePurchasesTableName,
            Key: {
              stripe_pi: { S: ticketId }
            },
            UpdateExpression: "SET scannerEmail = :scanner_email, scanISOTimestamp = :scan_time",
            ConditionExpression: "email = :email_val",
            ExpressionAttributeValues: {
              ":scanner_email": { S: request.username },
              ":scan_time": { S: (/* @__PURE__ */ new Date()).toISOString() },
              ":email_val": { S: request.body.email }
            }
          });
          break;
        case "ticket":
          ticketId = request.body.ticketId;
          command = new UpdateItemCommand({
            TableName: genericConfig.TicketPurchasesTableName,
            Key: {
              ticket_id: { S: ticketId }
            },
            UpdateExpression: "SET scannerEmail = :scanner_email, scanISOTimestamp = :scan_time",
            ExpressionAttributeValues: {
              ":scanner_email": { S: request.username },
              ":scan_time": { S: (/* @__PURE__ */ new Date()).toISOString() }
            }
          });
          break;
        default:
          throw new ValidationError({
            message: `Unknown verification type!`
          });
      }
      await fastify2.dynamoClient.send(command);
      reply.send(response);
      request.log.info(
        { type: "audit", actor: request.username, target: ticketId },
        `checked in ticket of type "${request.body.type}" ${request.body.type === "merch" ? `purchased by email ${request.body.email}.` : "."}`
      );
    }
  );
};
var tickets_default = ticketsPlugin;

// index.ts
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import NodeCache from "node-cache";
import { DynamoDBClient as DynamoDBClient3 } from "@aws-sdk/client-dynamodb";
import { SecretsManagerClient as SecretsManagerClient2 } from "@aws-sdk/client-secrets-manager";

// routes/mobileWallet.ts
import { z as z8 } from "zod";

// functions/membership.ts
async function checkPaidMembership(endpoint, log, netId) {
  const membershipApiPayload = await (await fetch(`${endpoint}?netId=${netId}`)).json();
  log.trace(`Got Membership API Payload for ${netId}: ${membershipApiPayload}`);
  try {
    return membershipApiPayload["isPaidMember"];
  } catch (e) {
    if (!(e instanceof Error)) {
      log.error(
        "Failed to get response from membership API (unknown error type.)"
      );
      throw e;
    }
    log.error(`Failed to get response from membership API: ${e.toString()}`);
    throw e;
  }
}

// ../common/types/sqsMessage.ts
import { z as z7 } from "zod";
var sqsMessageMetadataSchema = z7.object({
  reqId: z7.string().min(1),
  initiator: z7.string().min(1)
});
var baseSchema2 = z7.object({
  metadata: sqsMessageMetadataSchema
});
var createSQSSchema = (func, payloadSchema) => baseSchema2.extend({
  function: z7.literal(func),
  payload: payloadSchema
});
var sqsPayloadSchemas = {
  ["ping" /* Ping */]: createSQSSchema("ping" /* Ping */, z7.object({})),
  ["emailMembershipPass" /* EmailMembershipPass */]: createSQSSchema(
    "emailMembershipPass" /* EmailMembershipPass */,
    z7.object({ email: z7.string().email() })
  )
};
var sqsPayloadSchema = z7.discriminatedUnion(
  "function",
  [
    sqsPayloadSchemas["ping" /* Ping */],
    sqsPayloadSchemas["emailMembershipPass" /* EmailMembershipPass */]
  ]
);

// routes/mobileWallet.ts
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { zodToJsonSchema as zodToJsonSchema4 } from "zod-to-json-schema";
var queuedResponseJsonSchema = zodToJsonSchema4(
  z8.object({
    queueId: z8.string().uuid()
  })
);
var mobileWalletRoute = async (fastify2, _options) => {
  fastify2.post(
    "/membership",
    {
      schema: {
        response: { 202: queuedResponseJsonSchema },
        querystring: {
          type: "object",
          properties: {
            email: { type: "string", format: "email" }
          },
          required: ["email"]
        }
      }
    },
    async (request, reply) => {
      if (!request.query.email) {
        throw new UnauthenticatedError({ message: "Could not find user." });
      }
      try {
        await z8.string().email().refine(
          (email) => email.endsWith("@illinois.edu"),
          "Email must be on the illinois.edu domain."
        ).parseAsync(request.query.email);
      } catch {
        throw new ValidationError({
          message: "Email query parameter is not a valid email"
        });
      }
      const isPaidMember = await checkPaidMembership(
        fastify2.environmentConfig.MembershipApiEndpoint,
        request.log,
        request.query.email.replace("@illinois.edu", "")
      );
      if (!isPaidMember) {
        throw new UnauthenticatedError({
          message: `${request.query.email} is not a paid member.`
        });
      }
      const sqsPayload = {
        function: "emailMembershipPass" /* EmailMembershipPass */,
        metadata: {
          initiator: "public",
          reqId: request.id
        },
        payload: {
          email: request.query.email
        }
      };
      if (!fastify2.sqsClient) {
        fastify2.sqsClient = new SQSClient({
          region: genericConfig.AwsRegion
        });
      }
      const result = await fastify2.sqsClient.send(
        new SendMessageCommand({
          QueueUrl: fastify2.environmentConfig.SqsQueueUrl,
          MessageBody: JSON.stringify(sqsPayload)
        })
      );
      if (!result.MessageId) {
        request.log.error(result);
        throw new InternalServerError({
          message: "Could not add job to queue."
        });
      }
      request.log.info(`Queued job to SQS with message ID ${result.MessageId}`);
      reply.status(202).send({ queueId: result.MessageId });
    }
  );
};
var mobileWallet_default = mobileWalletRoute;

// routes/stripe.ts
import {
  PutItemCommand as PutItemCommand4,
  QueryCommand as QueryCommand5,
  ScanCommand as ScanCommand4
} from "@aws-sdk/client-dynamodb";
import { marshall as marshall4, unmarshall as unmarshall6 } from "@aws-sdk/util-dynamodb";

// functions/stripe.ts
import Stripe from "stripe";
var createStripeLink = async ({
  invoiceId,
  invoiceAmountUsd,
  contactName,
  contactEmail,
  createdBy,
  stripeApiKey
}) => {
  const stripe = new Stripe(stripeApiKey);
  const description = `Created for ${contactName} (${contactEmail}) by ${createdBy}.`;
  const product = await stripe.products.create({
    name: `Payment for Invoice: ${invoiceId}`,
    description
  });
  const price = await stripe.prices.create({
    currency: "usd",
    unit_amount: invoiceAmountUsd,
    product: product.id
  });
  const paymentLink = await stripe.paymentLinks.create({
    line_items: [
      {
        price: price.id,
        quantity: 1
      }
    ]
  });
  return {
    url: paymentLink.url,
    linkId: paymentLink.id,
    productId: product.id,
    priceId: price.id
  };
};

// ../common/types/stripe.ts
import { z as z9 } from "zod";
var invoiceLinkPostResponseSchema = z9.object({
  id: z9.string().min(1),
  link: z9.string().url()
});
var invoiceLinkPostRequestSchema = z9.object({
  invoiceId: z9.string().min(1),
  invoiceAmountUsd: z9.number().min(50),
  contactName: z9.string().min(1),
  contactEmail: z9.string().email()
});
var invoiceLinkGetResponseSchema = z9.array(
  z9.object({
    id: z9.string().min(1),
    userId: z9.string().email(),
    link: z9.string().url(),
    active: z9.boolean(),
    invoiceId: z9.string().min(1),
    invoiceAmountUsd: z9.number().min(50)
  })
);

// routes/stripe.ts
import { zodToJsonSchema as zodToJsonSchema5 } from "zod-to-json-schema";
var stripeRoutes = async (fastify2, _options) => {
  fastify2.get(
    "/paymentLinks",
    {
      schema: {
        response: { 200: zodToJsonSchema5(invoiceLinkGetResponseSchema) }
      },
      onRequest: async (request, reply) => {
        await fastify2.authorize(request, reply, ["create:stripeLink" /* STRIPE_LINK_CREATOR */]);
      }
    },
    async (request, reply) => {
      let dynamoCommand;
      if (request.userRoles?.has("bypass:ola" /* BYPASS_OBJECT_LEVEL_AUTH */)) {
        dynamoCommand = new ScanCommand4({
          TableName: genericConfig.StripeLinksDynamoTableName
        });
      } else {
        dynamoCommand = new QueryCommand5({
          TableName: genericConfig.StripeLinksDynamoTableName,
          KeyConditionExpression: "userId = :userId",
          ExpressionAttributeValues: {
            ":userId": { S: request.username }
          }
        });
      }
      let result;
      try {
        result = await fastify2.dynamoClient.send(dynamoCommand);
      } catch (e) {
        if (e instanceof BaseError) {
          throw e;
        }
        request.log.error(e);
        throw new DatabaseFetchError({
          message: "Could not get active links."
        });
      }
      if (result.Count === 0 || !result.Items) {
        return [];
      }
      const parsed = result.Items.map((item) => unmarshall6(item)).map(
        (item) => ({
          id: item.linkId,
          userId: item.userId,
          link: item.url,
          active: item.active,
          invoiceId: item.invoiceId,
          invoiceAmountUsd: item.amount
        })
      );
      reply.status(200).send(parsed);
    }
  );
  fastify2.post(
    "/paymentLinks",
    {
      schema: {
        response: { 201: zodToJsonSchema5(invoiceLinkPostResponseSchema) }
      },
      preValidation: async (request, reply) => {
        await fastify2.zodValidateBody(
          request,
          reply,
          invoiceLinkPostRequestSchema
        );
      },
      onRequest: async (request, reply) => {
        await fastify2.authorize(request, reply, ["create:stripeLink" /* STRIPE_LINK_CREATOR */]);
      }
    },
    async (request, reply) => {
      if (!request.username) {
        throw new UnauthenticatedError({ message: "No username found" });
      }
      const secretApiConfig = await getSecretValue(
        fastify2.secretsManagerClient,
        genericConfig.ConfigSecretName
      ) || {};
      if (!secretApiConfig) {
        throw new InternalServerError({
          message: "Could not connect to Stripe."
        });
      }
      const payload = {
        ...request.body,
        createdBy: request.username,
        stripeApiKey: secretApiConfig.stripe_secret_key
      };
      const { url, linkId, priceId, productId } = await createStripeLink(payload);
      const invoiceId = request.body.invoiceId;
      const dynamoCommand = new PutItemCommand4({
        TableName: genericConfig.StripeLinksDynamoTableName,
        Item: marshall4({
          userId: request.username,
          linkId,
          priceId,
          productId,
          invoiceId,
          url,
          amount: request.body.invoiceAmountUsd,
          active: true
        })
      });
      await fastify2.dynamoClient.send(dynamoCommand);
      request.log.info(
        {
          type: "audit",
          actor: request.username,
          target: `Link ${linkId} | Invoice ${invoiceId}`
        },
        "Created Stripe payment link"
      );
      reply.status(201).send({ id: linkId, link: url });
    }
  );
};
var stripe_default = stripeRoutes;

// index.ts
dotenv.config();
var now = () => Date.now();
async function init() {
  const dynamoClient = new DynamoDBClient3({
    region: genericConfig.AwsRegion
  });
  const secretsManagerClient = new SecretsManagerClient2({
    region: genericConfig.AwsRegion
  });
  const app = fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info"
    },
    rewriteUrl: (req) => {
      const url = req.url;
      const hostname = req.headers.host || "";
      const customDomainBaseMappers = {
        "ical.acm.illinois.edu": `/api/v1/ical${url}`,
        "ical.aws.qa.acmuiuc.org": `/api/v1/ical${url}`,
        "go.acm.illinois.edu": `/api/v1/linkry/redir${url}`,
        "go.aws.qa.acmuiuc.org": `/api/v1/linkry/redir${url}`
      };
      if (hostname in customDomainBaseMappers) {
        return customDomainBaseMappers[hostname];
      }
      return url || "/";
    },
    disableRequestLogging: true,
    genReqId: (request) => {
      const header = request.headers["x-apigateway-event"];
      if (!header) {
        return randomUUID2().toString();
      }
      const typeCheckedHeader = Array.isArray(header) ? header[0] : header;
      const event = JSON.parse(decodeURIComponent(typeCheckedHeader));
      return event.requestContext.requestId;
    }
  });
  await app.register(auth_default);
  await app.register(validate_default);
  await app.register(FastifyAuthProvider);
  await app.register(errorHandler_default);
  if (!process.env.RunEnvironment) {
    process.env.RunEnvironment = "dev";
  }
  if (!runEnvironments.includes(process.env.RunEnvironment)) {
    throw new InternalServerError({
      message: `Invalid run environment ${app.runEnvironment}.`
    });
  }
  app.runEnvironment = process.env.RunEnvironment;
  app.environmentConfig = environmentConfig[app.runEnvironment];
  app.nodeCache = new NodeCache({ checkperiod: 30 });
  app.dynamoClient = dynamoClient;
  app.secretsManagerClient = secretsManagerClient;
  app.addHook("onRequest", (req, _, done) => {
    req.startTime = now();
    const hostname = req.hostname;
    const url = req.raw.url;
    req.log.info({ hostname, url, method: req.method }, "received request");
    done();
  });
  app.addHook("onResponse", (req, reply, done) => {
    req.log.info(
      {
        url: req.raw.url,
        statusCode: reply.raw.statusCode,
        durationMs: now() - req.startTime
      },
      "request completed"
    );
    done();
  });
  app.get("/", (_, reply) => reply.send("Welcome to the ACM @ UIUC Core API!"));
  app.get("/api/v1/healthz", (_, reply) => reply.send({ message: "UP" }));
  await app.register(
    async (api, _options) => {
      api.register(protected_default, { prefix: "/protected" });
      api.register(events_default, { prefix: "/events" });
      api.register(organizations_default, { prefix: "/organizations" });
      api.register(ics_default, { prefix: "/ical" });
      api.register(iam_default, { prefix: "/iam" });
      api.register(tickets_default, { prefix: "/tickets" });
      api.register(mobileWallet_default, { prefix: "/mobileWallet" });
      api.register(stripe_default, { prefix: "/stripe" });
      if (app.runEnvironment === "dev") {
        api.register(vending_default, { prefix: "/vending" });
      }
    },
    { prefix: "/api/v1" }
  );
  await app.register(cors, {
    origin: app.environmentConfig.ValidCorsOrigins
  });
  app.log.info("Initialized new Fastify instance...");
  return app;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`Logging level set to ${process.env.LOG_LEVEL || "info"}`);
  const client = new STSClient({ region: genericConfig.AwsRegion });
  const command = new GetCallerIdentityCommand({});
  try {
    const data = await client.send(command);
    console.log(`Logged in to AWS as ${data.Arn} on account ${data.Account}.`);
  } catch {
    console.error(
      `Could not get AWS STS credentials: are you logged in to AWS? Run "aws configure sso" to log in.`
    );
    process.exit(1);
  }
  const app = await init();
  app.listen({ port: 8080 }, async (err) => {
    if (err) console.error(err);
  });
}
var index_default = init;
export {
  index_default as default
};
/*! Bundled license information:

moment-timezone/builds/moment-timezone-with-data-10-year-range.js:
  (*! moment-timezone.js *)
  (*! version : 0.5.47 *)
  (*! Copyright (c) JS Foundation and other contributors *)
  (*! license : MIT *)
  (*! github.com/moment/moment-timezone *)
*/
