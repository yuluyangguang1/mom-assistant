# pair.sh name  -> name_pair.jpg (before | after, 1/3 size)
cd /workspace/work/mom-assistant/_probe/s274
for n in "$@"; do
  montage ${n}_before*.png ${n}_after*.png -tile 2x1 -geometry 390x844+6+0 -background '#888' ${n}_pair.jpg 2>/dev/null || convert ${n}_before.png ${n}_after.png -resize 390x +append ${n}_pair.jpg
done
