const path = require("path");

// Set BUNDLE_DOCTOR_DEBUG=1 for an unminified bundle (easier stepping in the debugger).
const debug = process.env.BUNDLE_DOCTOR_DEBUG === "1";

module.exports = {
  mode: debug ? "development" : "production",
  // Emit index.js.map so debuggers map runtime code back to src/*.ts.
  devtool: "source-map",
  optimization: {
    minimize: !debug,
  },
  target: "node",
  entry: "./src/index.ts",

  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "index.js",
    library: {
      type: "commonjs2",
    },
    clean: true,
  },

  resolve: {
    extensions: [".ts", ".js"],
    extensionAlias: {
      ".js": [".ts", ".js"],
    },
  },

  module: {
    rules: [
      {
        test: /\.ts$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
    ],
  },

  // Externalizing webpack, acorn, and acorn-walk — they are large and already present
  // at runtime in any webpack project
  externals: [
    ({ request }, callback) => {
      if (
        request === "webpack" ||
        (request && request.startsWith("webpack/")) ||
        request === "acorn" ||
        request === "acorn-walk"
      ) {
        return callback(null, "commonjs " + request);
      }
      callback();
    },
  ],
};
