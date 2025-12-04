const { Client } = require("ssh2");

const runCommand = (host, cmd) => {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let result = "";
    conn
      .on("ready", () => {
        conn.exec(cmd, (err, stream) => {
          if (err) return reject(err);
          stream
            .on("data", (data) => {
              result += data.toString();
            })
            .on("close", () => {
              conn.end();
              resolve(result.trim());
            });
        });
      })
      .on("error", (err) => reject(err))
      .connect({ host, ...sshConfig });
  });
};

module.exports = { runCommand };
