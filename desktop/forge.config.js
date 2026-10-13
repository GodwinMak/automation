module.exports = {
  packagerConfig: {
    asar: true,
    icon: "./assets/icons/icon",
    executableName: "lit-terminal",
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {},
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin", "linux", "win32"],
    },
    {
      name: "@electron-forge/maker-deb",
      config: {
        options: {
          productName: "LIT Terminal",
          name: "lit-terminal",
          bin: "lit-terminal",
          icon: "./assets/icons/icon.svg",
          categories: ["Network", "Utility"],
          maintainer: "Liquid Intelligence Technologies",
        },
      },
    },
    {
      name: "@electron-forge/maker-rpm",
      config: {
        options: {
          productName: "LIT Terminal",
          name: "lit-terminal",
          bin: "lit-terminal",
          icon: "./assets/icons/icon.svg",
          categories: ["Network", "Utility"],
        },
      },
    },
  ],
};
