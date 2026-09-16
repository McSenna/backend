"use strict";
const { cidImg } = require("./assets");

const C = {
  pearl:        "#FFF7E6",
  pearlMid:     "#F5E4B8",
  pearlDeep:    "#F0D8A0",
  pearlBorder:  "#F0E2BC",
  pearlGold:    "#C49A3C",
  pearlGoldSoft:"#E8D890",
  midnight:     "#102E4A",
  midnightDeep: "#0A1E30",
  midnightMid:  "#1A4568",
  midnightLight:"#2D6B9E",
  skyBg:        "#E6F2FB",
  skyBorder:    "#B8D8F0",
  sageBg:       "#E8F6EE",
  sageBorder:   "#AADAC0",
  sageText:     "#1E5C38",
  goldBg:       "#FEF3DC",
  goldBorder:   "#F0D080",
  goldText:     "#8A6010",
  mist:         "#F4F7FA",
  mistBorder:   "#E0EAF2",
  white:        "#FFFFFF",
  bgOuter:      "#D6DDE4",
  textDark:     "#0E2038",
  textMid:      "#3A5068",
  textLight:    "#6A8A9E",
  textSubtle:   "#4A6E8A",
  textMuted:    "#8AAABB",
  red:          "#C0392B",
};

const fonts = {
  sans:  `'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`,
  serif: `'DM Serif Display', Georgia, 'Times New Roman', serif`,
  link:  `<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"/>`,
};

module.exports = { C, fonts };
