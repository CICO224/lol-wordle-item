<img src="assets/icon.svg" width="64" height="64" alt="">

# Recipe Rift

An endless League of Legends item puzzle with two modes:

- **Imposter** – the full recipe is shown plus one component that doesn't belong. Tap the imposter, then name the finished item.
- **Missing** – one real component is hidden behind the `?` tile. Name it, then name the finished item.

You get 6 attempts per puzzle. Correct answers lock in, every item shows its gold price, and the Oracle hints at cost (higher/lower), shared stats and shared components.
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
