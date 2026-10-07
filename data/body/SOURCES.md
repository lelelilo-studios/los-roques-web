# Where this body comes from

Built by `pipeline/body/build.mjs` from files of the MakeHuman project, which released its base mesh, shape
targets, skeleton, vertex weights and skins under **CC0 1.0** in September 2020 (each file says so itself, and
the tool refuses the skeleton, the weights and the skin if they do not). CC0 asks for no credit; this note is
here so that the origin is on record.

- Repository https://github.com/makehumancommunity/makehuman at commit `a8bc2d54ff0ac92e78ff71431b1023eda42bf482`:
  `makehuman/data/3dobjs/base.obj`, `makehuman/data/rigs/default.mhskel`, `makehuman/data/rigs/default_weights.mhw`, `caucasian-female-young.target`, `asian-female-young.target`, `african-female-young.target`, licence text `LICENSE.ASSETS.md`.
- Skin picture `skins/young_caucasian_female/young_lightskinned_female_diffuse.png` from the CC0 system-assets pack, https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip
- MakeHuman on its licences: https://static.makehumancommunity.org/makehuman/faq/are_makehuman_files_free.html

What the tool changed: the shape of a young adult woman (an equal mix of MakeHuman's three ethnic shapes) scaled
to 1.63 m; turned to this project's axes; the skin subdivided 1 time(s); weights cut to four bones a
vertex; a field added that says where the bikini lies.
