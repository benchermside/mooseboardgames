// A tiny two-player game that ends after three moves, so the S3 check can
// reach game over quickly.
export const Tally = {
    name: 'tally',
    setup: () => ({ count: 0 }),
    moves: {
        bump: ({ G }) => {
            G.count += 1;
        },
    },
    endIf: ({ G }) => (G.count >= 3 ? { winner: '0' } : undefined),
};
