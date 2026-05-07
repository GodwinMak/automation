export const T = {
  bg:"#0a0e14", bg2:"#111722", bg3:"#1a2234", bg4:"#222d42",
  border:"#2a3a56", border2:"#3a4f72",
  text:"#c8d8f0", text2:"#7a9abf", text3:"#4a6a8f",
  blue:"#4a9eff", blue2:"#2a7fdd", blue3:"#1a5faa",
  green:"#2dce8a", amber:"#ffb347", red:"#ff5a5a", purple:"#9b7fff",
  mono:"'JetBrains Mono',monospace", sans:"'Inter',sans-serif",
};

export const isAGGNode  = n => /AGG/i.test(n);
export const isPENode   = n => /-PE\d/i.test(n);
export const isBNGNode  = n => /BNG/i.test(n);
export const isCoreNode = n => /^LTZ-P\d/i.test(n)||/^LZA-P/i.test(n)||/^LZM-P/i.test(n);


export const SEV_COLORS={CRITICAL:T.red,HIGH:T.amber,MEDIUM:T.purple,LOW:T.green};
export const SEV_BGS={CRITICAL:"rgba(255,90,90,.15)",HIGH:"rgba(255,179,71,.15)",MEDIUM:"rgba(155,127,255,.15)",LOW:"rgba(45,206,138,.15)"};