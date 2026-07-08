// The aerial standard (founder directive, 2026-07): ONLY pure aerial/overhead
// shots of open land — calm, macOS-wallpaper energy. No ground-level photos,
// no fences, tractors, animals, people, buildings-as-subject, or city scenes.
// Every file listed here passed a frame-by-frame review against that bar;
// additions must clear the same review before landing.
const AERIAL_IMAGES = [
  "/images/aerial_view_agricult_bb80b667.jpg",
  "/images/aerial_view_agricult_dbaa8510.jpg",
  "/images/aerial_view_agricult_f0595ef3.jpg",
  "/images/aerial_view_country__4e601a11.jpg",
  "/images/aerial_view_country__cc4c6e1a.jpg",
  "/images/aerial_view_desert_l_f93727eb.jpg",
  "/images/aerial_view_farmland_56dd59e6.jpg",
  "/images/aerial_view_farmland_9b122452.jpg",
  "/images/aerial_view_forest_c_77851661.jpg",
  "/images/aerial_view_forest_c_82752a2b.jpg",
  "/images/aerial_view_forest_c_a6057466.jpg",
  "/images/aerial_view_mountain_0fc8c2fb.jpg",
  "/images/aerial_view_mountain_7614d7ac.jpg",
  "/images/aerial_view_mountain_c23d2c16.jpg",
  "/images/aerial_view_new_mexi_1f1bdfd8.jpg",
  "/images/aerial_view_new_mexi_e4198099.jpg",
  "/images/aerial_view_pasture__6ff70ca1.jpg",
  "/images/aerial_view_prairie__8ed44288.jpg",
  "/images/aerial_view_prairie__eb3a0fbb.jpg",
  "/images/aerial_view_property_cab6b0b8.jpg",
  "/images/aerial_view_rolling__906fb1d3.jpg",
  "/images/aerial_view_rural_ro_ba1d7011.jpg",
  "/images/aerial_view_rural_ro_fea6ac89.jpg",
  "/images/aerial_view_southwes_721fb283.jpg",
  "/images/aerial_view_vacant_l_571c249c.jpg",
  "/images/aerial_view_vacant_l_7e692e88.jpg",
  "/images/aerial_view_wide_hor_2dcf51b8.jpg",
  "/images/aerial_view_wide_hor_f822f070.jpg",
];

export const getRandomImage = () => {
  return AERIAL_IMAGES[Math.floor(Math.random() * AERIAL_IMAGES.length)];
};

export const getAllImages = () => {
  return [...AERIAL_IMAGES];
};

export const getImageCount = () => {
  return AERIAL_IMAGES.length;
};
