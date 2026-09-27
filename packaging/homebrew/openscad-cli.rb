# SPDX-License-Identifier: GPL-2.0-or-later
# Copyright (C) 2026 the openscad-cli authors
#
# Homebrew formula for openscad-cli.
#
# A tap is a git repository whose root contains a Formula/ directory. Publish
# this repo as `homebrew-openscad-cli` and users install with:
#
#   brew tap atom2ueki/openscad-cli
#   brew install atom2ueki/openscad-cli/openscad-cli
#
# Why a bottle rather than a plain tarball: a headless OpenSCAD links against
# boost, CGAL, GMP, MPFR, Eigen, TBB, glib, harfbuzz, fontconfig, freetype,
# double-conversion, libxml2, libzip and OpenSSL. A copied executable will not
# resolve those on a clean machine. A Homebrew bottle is a relocatable bundle
# with those dependencies resolved, which is also how OpenSCAD itself ships on
# macOS.
#
# The engine is built by this formula with -DHEADLESS=ON -DNULLGL=ON, so the
# installed `openscad-cli` needs no Qt, no OpenGL and no display server.

class OpenscadCli < Formula
  desc "Agent-facing CLI for the OpenSCAD core engine"
  homepage "https://github.com/atom2ueki/openscad-cli"
  url "https://github.com/atom2ueki/openscad-cli/releases/download/v1.0.0/openscad-cli-1.0.0-src.tar.gz"
  version "1.0.0"
  license "GPL-2.0-or-later"
  head "https://github.com/atom2ueki/openscad-cli.git", branch: "main"

  # Runtime dependencies of the engine, plus node for the CLI itself.
  depends_on "node"
  depends_on "boost" => :build
  depends_on "eigen" => :build
  depends_on "cgal" => :build
  depends_on "glib" => :build
  depends_on "freetype" => :build
  depends_on "harfbuzz" => :build
  depends_on "fontconfig" => :build
  depends_on "libzip" => :build
  depends_on "libxml2" => :build
  depends_on "double-conversion" => :build
  depends_on "tbb" => :build
  depends_on "glib" => :build
  depends_on "lib3mf" => :build
  # mbedtls is OpenSSL's dependency on macOS.
  depends_on "mbedtls" => :build

  def install
    # 1. Build the CLI.
    system "npm", "install", "--omit=dev"
    system "npm", "run", "build"
    libexec.install Dir["dist/**/*"]
    bin.install_symlink libexec/"dist/cli.js" => "openscad-cli"

    # 2. Build the headless engine from the vendored source tree.
    engine_args = %W[
      -Bbuild-engine
      -DCMAKE_BUILD_TYPE=Release
      -DHEADLESS=ON
      -DNULLGL=ON
      -DAPPLE_UNIX=ON
      -DUSE_QT6=0
      -DEXPERIMENTAL=ON
      -DENABLE_CGAL=ON
      -DUSE_MIMALLOC=OFF
      -DCMAKE_INSTALL_PREFIX=#{prefix}
    ]
    system "cmake", "-S", "engine", *engine_args
    system "cmake", "--build", "build-engine", "--parallel", ENV["HOMEBREW_BUILD_JOBS"]

    # 3. Install the engine next to the CLI so engine discovery finds it
    #    without any environment variable.
    (lib/"openscad-engine").install Dir["build-engine/**/openscad*"]
    (lib/"openscad-engine/libraries").install_symlink(
      Pathname.pwd/"engine/libraries"
    ) if (Pathname.pwd/"engine/libraries").exist?

    # 4. The skill, so `openscad-cli skill` and agent installs work.
    (share/"openscad-cli").install Dir["skill/**/*"]
  end

  def caveats
    <<~EOS
      This CLI drives a headless build of the OpenSCAD engine: no GUI, no
      OpenGL and no display server required. PNG rendering and the interactive
      preview are therefore not available; export meshes (STL/3MF/OFF/OBJ) and
      2D vectors (DXF/SVG/PDF) instead.

      Verify the installation with:
        openscad-cli doctor

      Licensed under GPL-2.0-or-later. The complete corresponding source,
      including the OpenSCAD engine, is published with every release at
      https://github.com/atom2ueki/openscad-cli/releases
    EOS
  end

  test do
    assert_match "openscad-cli", shell_output("#{bin}/openscad-cli --version")
    # `info` must not require an engine to be present to render its help.
    assert_match "openscad-cli/result@1", shell_output("#{bin}/openscad-cli info --format json")
  end
end
