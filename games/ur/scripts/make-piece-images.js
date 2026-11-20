// Generates the piece and pile SVGs into images/generated/, plus piles.css with a class per pile
// image (e.g. `.pile-0-3`). Run by `npm run images`, which `npm start` and `npm run build` do first.
import { mkdirSync, writeFileSync } from "node:fs";

const outDir = new URL("../images/generated/", import.meta.url);

const LIGHT = "#b0a38f";
const DARK = "#584d3b";
const PLAYERS = [
    { body: LIGHT, pips: DARK },
    { body: DARK, pips: LIGHT },
];

// Pips on a piece, like the 5 on a die.
const PIPS = [[50, 50], [34, 34], [66, 34], [34, 66], [66, 66]];

// Pieces in a pile have radius R (to the outside of the stroke): a pile of 7 just fills the
// viewBox height, with neighboring pieces touching.
const R = 100 / 6;
const PILE_PIECE_SIZE = 100 * R / 38.25;  // a piece's outer edge is 37.5 + half its 1.5 stroke
const LEFT = 50 - Math.sqrt(3) * R;
const RIGHT = 50 + Math.sqrt(3) * R;
const TOP = 50 - 2 * R;
const MIDDLE = 50;
const BOTTOM = 50 + 2 * R;

// Centers of the pieces in a pile, in the order they're added; a pile of n uses the first n.
// 2, 4 and 6 look like a die; the 7th is nestled between the top four.
const PILE_POSITIONS = [
    [RIGHT, BOTTOM],
    [LEFT, TOP],
    [LEFT, BOTTOM],
    [RIGHT, TOP],
    [LEFT, MIDDLE],
    [RIGHT, MIDDLE],
    [50, 50 - R],
];

const fmt = n => +n.toFixed(3);

// Lines drawing a piece in a 100x100 viewBox.
function pieceLines({ body, pips }) {
    return [
        `<circle cx="50" cy="50" r="37.5" fill="${body}" stroke="black" stroke-width="1.5"/>`,
        `<g fill="${pips}">`,
        ...PIPS.map(([x, y]) => `  <circle cx="${x}" cy="${y}" r="6.5"/>`),
        `</g>`,
    ];
}

// Lines drawing a pile of `count` pieces.
function pileLines(player, count) {
    if (count === 0) {
        return [];
    }
    const offset = PILE_PIECE_SIZE / 2;
    const size = fmt(PILE_PIECE_SIZE);
    return [
        `<defs>`,
        `  <symbol id="piece" viewBox="0 0 100 100">`,
        ...indent(pieceLines(player), "    "),
        `  </symbol>`,
        `</defs>`,
        ...PILE_POSITIONS.slice(0, count).map(([x, y]) =>
            `<use href="#piece" x="${fmt(x - offset)}" y="${fmt(y - offset)}" width="${size}" height="${size}"/>`),
    ];
}

function indent(lines, prefix) {
    return lines.map(line => prefix + line);
}

function svg(lines) {
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">`,
        ...indent(lines, "  "),
        `</svg>`,
    ].join("\n") + "\n";
}

mkdirSync(outDir, { recursive: true });
const pileRules = [];
PLAYERS.forEach((player, x) => {
    writeFileSync(new URL(`player-${x}-piece.svg`, outDir), svg(pieceLines(player)));
    for (let y = 0; y <= PILE_POSITIONS.length; y++) {
        writeFileSync(new URL(`player-${x}-pile-${y}.svg`, outDir), svg(pileLines(player, y)));
        pileRules.push(`.pile-${x}-${y} { background-image: url("player-${x}-pile-${y}.svg"); }`);
    }
});
writeFileSync(new URL("piles.css", outDir), pileRules.join("\n") + "\n");
