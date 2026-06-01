import React, { useRef, useEffect } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { io } from "socket.io-client";
import "@xterm/xterm/css/xterm.css";
import { PRODUCTION_URL } from "@/utils/Api";
import { FitAddon } from "xterm-addon-fit";
import { WebLinksAddon } from "xterm-addon-web-links";

// Add onClose to the component props
const Terminal = ({ connection, onClose }) => {
  const fitAddon = new FitAddon();
  const terminalRef = useRef(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      theme: {
        background: "#000000", // black background
        foreground: "#08f508ff", // light green text (hex for lightgreen)
        cursor: "#0eeb0eff", // light green cursor
      },
    });

    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(terminalRef.current);

    term.open(terminalRef.current);

    fitAddon.fit();

    // Re-fit when window is resized
    window.addEventListener("resize", fitAddon.fit);

    term.write("Hello from \x1B[1;3;31mxterm.js\x1B[0m $ ");


    // 🚀 CRITICAL FIX: Force pure websocket mode for stable SSH streaming
    const socket = io(`${PRODUCTION_URL}`, {
      transports: ["websocket"],
      upgrade: false
    });
    socket.emit("connectDevice", connection);

    socket.on("output", (data) => term.write(data));
    term.onData((data) => socket.emit("input", data));

    // Clean up the socket and terminal instance when the component unmounts
    return () => {
      socket.disconnect();
      window.removeEventListener("resize", fitAddon.fit);
      term.dispose();
    };
  }, [connection]);

  return (
    <main className="h-screen w-screen bg-black relative">
      <button
        onClick={onClose}
        className="absolute top-4 right-8 text-white text-3xl z-50 hover:text-red-500"
      >
        &times;
      </button>
      <div
        ref={terminalRef}
        className="h-screen w-full bg-black text-green-400 p-1 rounded-lg shadow-lg overflow-hidden"
      />
    </main>
  );
};

export default Terminal;
