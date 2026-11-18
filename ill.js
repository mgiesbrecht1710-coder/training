/* Gezeichnete Geräte-Bilder. Figur = hell, Gerät = grau, Bewegungsrichtung = grüner Pfeil. viewBox 240x160. */
'use strict';
(function () {
  const P = (pts) => `<polyline class="f" points="${pts}"/>`;
  const M = (pts) => `<polyline class="m" points="${pts}"/>`;
  const H = (x, y, r = 11) => `<circle class="hd" cx="${x}" cy="${y}" r="${r}"/>`;
  const R = (x, y, w, h, r = 4) => `<rect class="mf" x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`;
  function A(x1, y1, x2, y2) {
    const a = Math.atan2(y2 - y1, x2 - x1), s = 11;
    const p1 = [x2 - s * Math.cos(a - 0.5), y2 - s * Math.sin(a - 0.5)], p2 = [x2 - s * Math.cos(a + 0.5), y2 - s * Math.sin(a + 0.5)];
    const ex = x2 - 6 * Math.cos(a), ey = y2 - 6 * Math.sin(a);
    return `<line class="a" x1="${x1}" y1="${y1}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}"/><polygon class="ah" points="${x2},${y2} ${p1[0].toFixed(1)},${p1[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}"/>`;
  }
  const floor = '<line class="fl" x1="10" y1="150" x2="230" y2="150"/>';

  const D = {
    latpull: {
      label: 'Latziehen', svg:
        M('200,150 200,18 112,18') + `<line class="m" x1="120" y1="18" x2="120" y2="46" style="stroke-width:3"/>` +
        M('84,48 156,48') + R(96, 112, 58, 10) + M('125,122 125,150') + R(150, 96, 12, 16, 6) + M('110,150 140,150') +
        P('124,112 120,70') + H(119, 54) + P('120,72 101,62 92,48') + P('120,72 138,62 148,48') + P('124,112 158,108 160,146') +
        A(62, 36, 62, 82) + floor
    },
    row: {
      label: 'Rudern (Kabel)', svg:
        R(56, 118, 84, 10) + M('98,128 98,150') + M('206,150 206,88') + R(194, 104, 10, 34, 4) + `<line class="m" x1="206" y1="96" x2="126" y2="96" style="stroke-width:3"/>` +
        M('120,88 120,104') +
        P('92,116 98,72') + H(102, 56) + P('98,74 76,94 118,96') + P('92,116 146,100 196,118') +
        A(184, 74, 140, 74) + floor
    },
    pushup: {
      label: 'Liegestütze', svg:
        P('30,140 110,118 172,100') + H(190, 92) + P('172,100 176,140') + `<line class="fl" x1="164" y1="143" x2="190" y2="143" style="stroke:#59616c;stroke-width:6;stroke-linecap:round"/>` +
        A(214, 110, 214, 80) + A(214, 110, 214, 140) +
        '<line class="fl" x1="10" y1="146" x2="230" y2="146"/>'
    },
    butterfly: {
      label: 'Butterfly', svg:
        R(104, 30, 32, 86, 8) + R(98, 110, 44, 12) + M('120,122 120,150') + M('62,22 62,96') + M('178,22 178,96') + R(54, 30, 16, 40, 6) + R(170, 30, 16, 40, 6) +
        H(120, 38) + P('120,54 120,108') + P('96,62 144,62') + P('98,62 70,66 64,40') + P('142,62 170,66 176,40') + P('112,110 104,148') + P('128,110 136,148') +
        A(30, 50, 52, 50) + A(210, 50, 188, 50) + floor
    },
    legpress: {
      label: 'Beinpresse', svg:
        M('34,64 64,128 110,128') + M('96,144 224,56') + R(150, 54, 12, 62, 4) + M('64,128 64,150') +
        P('74,120 48,82') + H(40, 66) + P('50,86 76,108') + P('74,120 116,82 150,92') +
        A(168, 112, 206, 86) + floor
    },
    legext: {
      label: 'Beinstrecker', svg:
        R(64, 96, 70, 10) + R(58, 40, 12, 66, 5) + M('120,106 120,150') + M('96,150 144,150') + M('132,104 184,74') + `<circle class="mf" cx="186" cy="74" r="9"/>` +
        P('86,94 82,56') + H(82, 40) + P('82,58 96,80 104,98') + P('86,94 132,94 178,70') +
        A(166, 128, 202, 100) + floor
    },
    lateral: {
      label: 'Seitheben', svg:
        H(120, 28) + P('120,44 120,98') + P('100,52 140,52') + P('100,52 62,58') + P('140,52 178,58') + P('112,98 106,148') + P('128,98 134,148') +
        `<line class="m" x1="56" y1="46" x2="56" y2="70" style="stroke-width:9"/><line class="m" x1="184" y1="46" x2="184" y2="70" style="stroke-width:9"/>` +
        A(34, 104, 34, 66) + A(206, 104, 206, 66) + floor
    },
    press: {
      label: 'Drücken (Brust/Schulter)', svg:
        R(56, 40, 14, 76, 5) + R(56, 108, 66, 10) + M('100,118 100,150') + M('150,26 150,110') + R(142, 62, 46, 10, 5) +
        P('72,106 76,62') + H(78, 46) + P('76,66 108,74 146,68') + P('72,106 118,108 120,146') +
        A(176, 92, 212, 92) + floor
    },
    curl: {
      label: 'Bizeps / Arme', svg:
        H(110, 28) + P('110,44 110,98') + P('92,52 128,52') + P('128,54 134,86 158,66') + P('92,54 88,96') +
        `<line class="m" x1="160" y1="54" x2="164" y2="78" style="stroke-width:9"/><line class="m" x1="82" y1="96" x2="94" y2="104" style="stroke-width:9"/>` +
        P('102,98 96,148') + P('118,98 124,148') + A(184, 104, 180, 62) + floor
    },
    core: {
      label: 'Bauch / Rumpf', svg:
        P('40,140 84,116') + P('84,116 128,138') + P('84,116 112,84') + H(124, 72) + P('112,90 140,104') +
        A(170, 110, 140, 70) + '<line class="fl" x1="10" y1="146" x2="230" y2="146"/>'
    },
    cardio: {
      label: 'Cardio', svg:
        M('40,140 200,124') + M('186,126 196,52 176,50') +
        H(132, 34) + P('130,50 122,92') + P('128,58 150,74 172,60') + P('128,58 110,78') + P('122,92 146,110 140,136') + P('122,92 102,116 84,124') +
        A(60, 108, 30, 112) + floor
    },
    generic: {
      label: 'Sonstiges', svg:
        M('62,80 178,80') + R(52, 54, 16, 52, 5) + R(36, 62, 14, 36, 5) + R(172, 54, 16, 52, 5) + R(190, 62, 14, 36, 5) + floor
    },
  };
  window.ILL_KEYS = Object.keys(D);
  window.illLabel = (k) => (D[k] || D.generic).label;
  window.ill = function (k) {
    const d = D[k] || D.generic;
    return `<svg class="ill" viewBox="0 0 240 160" aria-hidden="true"><rect class="bgc" width="240" height="160"/>${d.svg}</svg>`;
  };
})();
