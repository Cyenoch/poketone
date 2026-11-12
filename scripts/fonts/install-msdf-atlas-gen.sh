#!/bin/sh
# Builds msdf-atlas-gen 1.4 on msdfgen 1.13 (the versions scripts/fonts/source.py pins) into $1
# (default .cache/msdf-atlas-gen), from SHA-256-checked release tarballs, with the options of the
# Homebrew formula the committed core set is baked with: no vcpkg, no Skia, external msdfgen.
# Needs cmake, a C++ compiler and the freetype, libpng and tinyxml2 development packages.
set -eu
prefix=$(cd "$(dirname "$0")/../.." && pwd)/.cache/msdf-atlas-gen
prefix=${1:-$prefix}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

fetch() { # name url sha256
  curl -fsSL -o "$work/$1.tgz" "$2"
  echo "$3  $work/$1.tgz" | sha256sum -c - >/dev/null 2>&1 || echo "$3  $work/$1.tgz" | shasum -a 256 -c - >/dev/null
  mkdir "$work/$1" && tar -xzf "$work/$1.tgz" -C "$work/$1" --strip-components 1
}
fetch msdfgen https://github.com/Chlumsky/msdfgen/archive/refs/tags/v1.13.tar.gz \
  93cd1ad8918c1a78c5c96e82d4f4c77f0eb86c2e7e8579a0967e54196c4b7167
fetch atlas https://github.com/Chlumsky/msdf-atlas-gen/archive/refs/tags/v1.4.tar.gz \
  57db9548b30905b18640ceab5011144e9d362f33a53748bef6be53dd743c9992

cmake -S "$work/msdfgen" -B "$work/msdfgen/build" -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$prefix" \
  -DMSDFGEN_USE_VCPKG=OFF -DMSDFGEN_USE_SKIA=OFF -DMSDFGEN_INSTALL=ON -DBUILD_SHARED_LIBS=ON
cmake --build "$work/msdfgen/build" --parallel
cmake --install "$work/msdfgen/build"
cmake -S "$work/atlas" -B "$work/atlas/build" -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$prefix" \
  -DCMAKE_PREFIX_PATH="$prefix" -DCMAKE_INSTALL_RPATH="$prefix/lib" \
  -DMSDF_ATLAS_USE_VCPKG=OFF -DMSDF_ATLAS_MSDFGEN_EXTERNAL=ON -DMSDF_ATLAS_USE_SKIA=OFF \
  -DMSDF_ATLAS_NO_ARTERY_FONT=ON -DMSDF_ATLAS_INSTALL=ON
cmake --build "$work/atlas/build" --parallel
cmake --install "$work/atlas/build"
"$prefix/bin/msdf-atlas-gen" -version
