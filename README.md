<img src="assets/icon.svg" width="64" height="64" alt="">

# Recipe Rift

A daily League of Legends item puzzle. Each round shows a finished item's recipe that has been tampered with:

1. **Imposter** – one shown component doesn't belong. Tap it.
2. **Missing** – one real component is hidden behind the `?` tile. Name it.
3. **Builds into** – name the finished item.

You get 6 attempts. Correct answers lock in, and the Oracle hints at cost (higher/lower), shared stats and shared components.
There are two modes: **Daily** (same puzzle for everyone each day) and **Endless**. Stats and streaks are saved in the browser.

## Run

No build step. Open `index.html` directly, or serve the folder:

```sh
npx serve .
```

## Item images

Put the PNGs in `assets/items/` using the file names listed in [IMAGES.md](IMAGES.md).
Until an image exists, the game shows a lettered placeholder tile.

## Updating to a new patch

Recipes come from Riot's Data Dragon. To regenerate `data.js` and `IMAGES.md` for the latest patch:

```sh
node scripts/build-data.mjs
```
