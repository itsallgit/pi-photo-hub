#!/bin/bash
# metadata-testset.sh - test which embedded metadata fields Picapport indexes (backlog B24).
# Runs on the Pi. Works ONLY in the test folder on the SD card (default /home/pi/picapport-testset),
# which Picapport scans as its second root (config/picapport.properties, robot.root.1). Never
# touches the photo HDD (hard rule 1): it refuses any folder under /mnt.
#
#   metadata-testset.sh create   make one small JPEG per test case, each carrying ONE field set to a
#                                unique word (needs exiftool and python3-pil, config/packages.txt)
#   metadata-testset.sh check    ask Picapport for each word; prints found / NOT found per field,
#                                plus the indexed words (textSearch) of the date/rating/GPS cases
#   metadata-testset.sh clean    delete the test JPEGs (the folder stays, empty), so they never
#                                appear in slideshows
#
# Picapport only sees new files after it has scanned the folder (at its start, and when its crawler
# runs); `check` first confirms each file is indexed at all (by its file-name word zqfNN).
set -euo pipefail
DIR="${TESTSET_DIR:-/home/pi/picapport-testset}"
PICAPPORT="${PICAPPORT_URL:-http://localhost:8080}"
case "$(realpath -m "$DIR")" in /mnt|/mnt/*) echo "refusing: $DIR is under /mnt (hard rule 1)" >&2; exit 1;; esac

# id ; what is tested ; exiftool arguments ; word(s) to search for
CASES=$(cat <<'T'
01;Windows XPKeywords only;-EXIF:XPKeywords=zqkwxp;zqkwxp
02;IPTC Keywords only;-IPTC:Keywords=zqkwiptc;zqkwiptc
03;XMP dc:subject only (control);-XMP-dc:Subject=zqkwdc;zqkwdc
04;XMP MicrosoftPhoto LastKeywordXMP only;-XMP-microsoft:LastKeywordXMP=zqkwms;zqkwms
05;XMP lr:HierarchicalSubject only;-XMP-lr:HierarchicalSubject=zqhierparent|zqhierchild;zqhierchild
06;XMP digiKam TagsList only;-XMP-digiKam:TagsList=zqdkparent/zqdkchild;zqdkchild
07;Windows XPTitle only;-EXIF:XPTitle=zqtitlexp;zqtitlexp
08;XMP dc:title only;-XMP-dc:Title=zqtitledc;zqtitledc
09;IPTC ObjectName only;-IPTC:ObjectName=zqtitleiptc;zqtitleiptc
10;IPTC Caption-Abstract only;-IPTC:Caption-Abstract=zqcapiptc;zqcapiptc
11;XMP dc:description only;-XMP-dc:Description=zqdescdc;zqdescdc
12;EXIF ImageDescription only;-EXIF:ImageDescription=zqdescexif;zqdescexif
13;EXIF UserComment only;-EXIF:UserComment=zqcommentexif;zqcommentexif
14;Windows XPComment only;-EXIF:XPComment=zqcommentxp;zqcommentxp
15;Windows XPSubject only;-EXIF:XPSubject=zqsubjectxp;zqsubjectxp
16;XMP PersonInImage only;-XMP-iptcExt:PersonInImage=zqpersoniptc;zqpersoniptc
17;MWG face region name only;-XMP-mwg-rs:RegionInfo={AppliedToDimensions={W=64,H=64,Unit=pixel},RegionList=[{Area={X=0.5,Y=0.5,W=0.2,H=0.2,Unit=normalized},Name=zqpersonmwg,Type=Face}]};zqpersonmwg
18;Microsoft face region name only;-XMP-MP:RegionInfoMP={Regions=[{PersonDisplayName=zqpersonms}]};zqpersonms
19;keyword with a space (dc:subject "zqmulti zqword");-XMP-dc:Subject=zqmulti zqword;zqword
20;XMP Rating 5 only;-XMP:Rating=5;
21;EXIF GPS only (Sydney);-GPSLatitude=-33.8568 -GPSLatitudeRef=S -GPSLongitude=151.2153 -GPSLongitudeRef=E;
22;EXIF DateTimeOriginal 1999-12-31 only;-EXIF:DateTimeOriginal=1999:12:31 10:00:00;1999 dec dec31
23;XMP CreateDate 1998-06-15 only (no EXIF date);-XMP:CreateDate=1998:06:15 10:00:00;1998 jun
24;no metadata at all;
T
)

count() { curl -s -m 120 -G "$PICAPPORT/picapport_json" --data-urlencode cmd=RunQuery \
  --data-urlencode "query=$1" --data-urlencode sort=random | grep -oE '"numPhotos":[0-9]+' | head -1 | cut -d: -f2; }
words() { local j; j=$(mktemp)
  local vid; vid=$(curl -s -m 120 -c "$j" -b "$j" -G "$PICAPPORT/picapport_json" --data-urlencode cmd=RunQuery \
    --data-urlencode "query=$1" --data-urlencode sort=random | grep -oE '"vid":[0-9]+' | cut -d: -f2)
  curl -s -m 60 -c "$j" -b "$j" -G "$PICAPPORT/picapport_json" --data-urlencode cmd=GetMetaData \
    --data-urlencode "vid=$vid" --data-urlencode index=0 | grep -oE '"(textSearch|rating|latitude|creationDate)":("[^"]*"|[0-9.-]+)' | tr '\n' ' '
  rm -f "$j"; }

case "${1:-}" in
  create)
    command -v exiftool >/dev/null || { echo "exiftool missing" >&2; exit 1; }
    mkdir -p "$DIR"
    echo "$CASES" | while IFS=';' read -r id what args _; do
      [ -n "$id" ] || continue
      f="$DIR/zqf$id.jpg"
      python3 -c "from PIL import Image; Image.new('RGB',(64,64),($((10#$id*9)),120,200)).save('$f','JPEG')"
      if [ -n "$args" ]; then
        # the arguments are split on " -" so values may contain spaces
        mapfile -t a < <(printf '%s\n' "$args" | sed 's/ -/\n-/g')
        exiftool -q -overwrite_original "${a[@]}" "$f"
      fi
      echo "created $f ($what)"
    done
    ;;
  check)
    printf '%-4s %-48s %-8s %s\n' id "field tested" indexed "found by its word"
    echo "$CASES" | while IFS=';' read -r id what _ word; do
      [ -n "$id" ] || continue
      seen=$(count "zqf$id"); seen=${seen:-0}
      if [ -n "$word" ]; then hit=$(count "zqf$id $word"); hit=${hit:-0}; res=$([ "$hit" -ge 1 ] && echo found || echo "NOT found"); else res="(see words below)"; fi
      [ "$seen" -ge 1 ] || res="(file not indexed yet)"
      printf '%-4s %-48s %-8s %s\n' "$id" "$what" "$([ "$seen" -ge 1 ] && echo yes || echo no)" "$res"
    done
    echo; for id in 20 21 22 23 24; do echo "zqf$id: $(words "zqf$id")"; done
    ;;
  clean)
    rm -f "$DIR"/zqf*.jpg; echo "removed the test JPEGs from $DIR. Picapport keeps them in its index until its next start (dropped about 2.5 min after it) or its midnight scan."
    ;;
  *) sed -n '2,17p' "$0"; exit 2 ;;
esac
