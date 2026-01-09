const AERIAL_IMAGES = [
  "/attached_assets/stock_images/aerial_view_earth_la_ebbb258b.jpg",
  "/attached_assets/stock_images/aerial_view_earth_la_61c8b979.jpg",
  "/attached_assets/stock_images/aerial_view_earth_la_d6daf7fc.jpg",
  "/attached_assets/stock_images/aerial_view_earth_la_e6027f79.jpg",
  "/attached_assets/stock_images/aerial_view_earth_la_1032d15d.jpg",
  "/attached_assets/stock_images/aerial_view_coastlin_7795e651.jpg",
  "/attached_assets/stock_images/aerial_view_coastlin_b90c3dc1.jpg",
  "/attached_assets/stock_images/aerial_view_coastlin_c6b40269.jpg",
  "/attached_assets/stock_images/aerial_view_coastlin_e0e1413a.jpg",
  "/attached_assets/stock_images/aerial_view_coastlin_e5546ed2.jpg",
  "/attached_assets/stock_images/aerial_view_farmland_488b10bb.jpg",
  "/attached_assets/stock_images/aerial_view_farmland_7a839a84.jpg",
  "/attached_assets/stock_images/aerial_view_farmland_dd0949a9.jpg",
  "/attached_assets/stock_images/aerial_view_farmland_7eb11372.jpg",
  "/attached_assets/stock_images/aerial_view_farmland_be764c5d.jpg",
  "/attached_assets/stock_images/aerial_view_river_de_2bfec7d9.jpg",
  "/attached_assets/stock_images/aerial_view_river_de_40f28854.jpg",
  "/attached_assets/stock_images/aerial_view_river_de_ac8981ce.jpg",
  "/attached_assets/stock_images/aerial_view_river_de_f5ebb64d.jpg",
  "/attached_assets/stock_images/aerial_view_river_de_a2bbef0b.jpg",
  "/attached_assets/stock_images/aerial_view_forest_w_acbc4b43.jpg",
  "/attached_assets/stock_images/aerial_view_forest_w_20580d10.jpg",
  "/attached_assets/stock_images/aerial_view_forest_w_88e7e04f.jpg",
  "/attached_assets/stock_images/aerial_view_forest_w_403b4f9f.jpg",
  "/attached_assets/stock_images/aerial_view_forest_w_04e65f84.jpg",
];

export const getRandomImage = () => {
  return AERIAL_IMAGES[Math.floor(Math.random() * AERIAL_IMAGES.length)];
};
