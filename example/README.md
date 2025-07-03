# Example app

This folder contains an Expo application demonstrating how to use **react-native-deepgram**.

## Running the example

1. Install the workspace dependencies from the repo root:

   ```sh
   yarn install
   ```

2. Start Expo from the `example` directory:

   ```sh
   cd example
   yarn start
   ```

3. In another terminal, build and run the platform target.

   ```sh
   npx expo prebuild
   npx expo run:ios       # or expo run:android
   ```

Make sure you replace `YOUR_API_KEY` in `src/App.tsx` with a valid Deepgram key before running the app.
