<img src="assets/icon.svg" width="64" height="64" alt="">

# Recipe Rift

An endless League of Legends item puzzle. Every puzzle is shown as a recipe tree (finished item on top, components branching below), with three modes:

- **Build** – the full recipe is shown. Name the finished item.
- **Imposter** – the full recipe is shown plus one component that doesn't belong. Tap the imposter, then name the finished item.
- **Missing** – one real component is hidden behind the `?` tile. Name it, then name the finished item.

You get 6 attempts per puzzle. Every box shows the item's gold price and stats. After 3 guesses, a hint panel next to the finished item unlocks its gold price and full stats.
Puzzles are generated so that exactly one answer fits the board alone (no recipe twins), and the Oracle adds hints after each guess.
Sound effects are synthesized with the Web Audio API (no audio files); the speaker button in the top bar mutes them.
Each mode keeps its own stats in the browser: played, win rate, current and best streak, average guesses and guess distribution. Giving up counts as a loss.

## Run

No build step. Open `index.html` directly, or serve the folder:

```sh
npx serve .
```

## Item images

Icons live in `assets/items/` using the file names listed in [IMAGES.md](IMAGES.md).
They are downloaded from the [League of Legends Wiki](https://wiki.leagueoflegends.com/en-us/Category:High_definition_item_icons) (HD icons, 128px):

```sh
node scripts/fetch-wiki-icons.mjs          # only downloads icons that are missing
node scripts/fetch-wiki-icons.mjs --force  # re-download everything
```

If an icon is missing, the game shows a lettered placeholder tile.

## Updating to a new patch

Recipes come from Riot's Data Dragon. To regenerate `data.js` and `IMAGES.md` for the latest patch:

```sh
node scripts/build-data.mjs
```
