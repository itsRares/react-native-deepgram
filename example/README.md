# Example app

This folder contains a bare React Native application demonstrating how to use **react-native-deepgram**.

## Running the example

1. Install the workspace dependencies from the repo root:

   ```sh
   yarn install
   ```

2. Start Metro from the `example` directory:

   ```sh
   cd example
   yarn start
   ```

3. In another terminal run the platform target:

   ```sh
   yarn ios       # or yarn android
   ```

Make sure you replace `YOUR_API_KEY` in `src/App.tsx` with a valid Deepgram key before running the app.
