// Example data only: invented names and numbers, not a real account and not a recommendation.
// The dashboard in the kit builds this same object from your own repo every day.
window.DEMO = {
  start: 5000,
  opened: "2026-09-07",
  halt: 4250,
  // daily closes of the account (the last one is replaced by the live holdings total)
  days: ["2026-09-07","2026-09-08","2026-09-09","2026-09-10","2026-09-11","2026-09-14","2026-09-15","2026-09-16","2026-09-17","2026-09-18","2026-09-21","2026-09-22","2026-09-23","2026-09-24","2026-09-25","2026-09-28","2026-09-29","2026-09-30","2026-10-01","2026-10-02","2026-10-05","2026-10-06","2026-10-07","2026-10-08","2026-10-09"],
  acct:  [5000,4991,5017,5042,5030,5006,5045,5084,5111,5100,5075,5127,5155,5175,5142,5120,5162,5201,5182,5218,5235,5202,5226,5248,5260],
  // weekly benchmark closes, indexed to 100 on the opening day
  bench: {
    "2026-09-07":{us:100,tech:100,chips:100},
    "2026-09-11":{us:100.2,tech:100.6,chips:101.1},
    "2026-09-18":{us:100.9,tech:101.8,chips:102.9},
    "2026-09-25":{us:101.3,tech:102.4,chips:103.6},
    "2026-10-02":{us:101.9,tech:103.1,chips:104.8},
    "2026-10-09":{us:102.1,tech:103.5,chips:105.6}
  },
  cash: 124.50,
  moonshot: {pot: 500, held: 0, slots: 2},
  // name, short label, sleeve, theme, value £, return % since bought, target %, actual %
  holdings: [
    ["Chip-makers fund","Chips fund","core","Chip makers",690.20,13.7,13.0,13.1],
    ["Tech-heavy index fund","Tech index","core","Tech index",662.40,7.2,13.0,12.6],
    ["Emerging markets fund","EM fund","core","Emerging markets",648.30,3.3,13.0,12.3],
    ["Commodities fund","Commods","core","Commodities",640.10,0.6,13.0,12.2],
    ["Energy fund","Energy","core","Energy",631.60,0.4,13.0,12.0],
    ["Stock A · chips","Stock A","satellite","Chip makers",362.40,22.9,5.8,6.9],
    ["Stock B · memory","Stock B","satellite","Chip makers",334.10,13.5,5.8,6.4],
    ["Stock C · servers","Stock C","satellite","AI hardware",311.80,9.2,5.8,5.9],
    ["Stock D · networking","Stock D","satellite","AI hardware",296.20,4.8,5.8,5.6],
    ["Stock E · storage","Stock E","satellite","AI hardware",288.30,3.4,5.8,5.5],
    ["Stock F · power","Stock F","satellite","Power",270.10,-4.3,5.8,5.1]
  ],
  // stock, close, trailing stop, 40-week average  (prices in each stock's own currency)
  stops: [
    ["Stock F",63.40,52.40,58.90],["Stock E",142.80,118.30,121.60],["Stock D",208.10,171.90,169.40],
    ["Stock C",90.10,72.10,70.20],["Stock B",427.30,331.80,318.70],["Stock A",286.90,214.50,201.10]
  ],
  orders: [
    ["2026-10-05","Monthly rebalance","5 orders","Filled","p-good","All five landed. The month was marked done only after the broker confirmed each one."],
    ["2026-09-28","Stock F · power","Buy £280","Filled","p-good","New position: top of the weekly screen, above its 40-week average."],
    ["2026-09-21","Stock E · storage","Buy £280","Rejected, then filled","p-warn","Amount had 6 decimal places and the exchange accepts 4. Rounded and resent automatically."],
    ["2026-09-14","Satellite buys","4 orders","Filled","p-good","Stocks A to D bought at the profile's size."],
    ["2026-09-07","Opening buys","5 orders","Filled","p-good","Core funds bought at target weights."]
  ],
  // core momentum ranking (blended 3/6/12-month), shown in the weekly signals report
  ranking: [["Chip-makers fund",48.2],["Commodities fund",26.9],["Energy fund",22.4],["Tech-heavy index fund",18.7],["Emerging markets fund",15.9],["US large caps fund",12.1],["Health care fund",10.4],["Small caps fund",7.2],["Developed ex-US fund",6.5],["Industrials fund",2.6]],
  watchlist: [["Stock G","optics",0.89,24],["Stock H","cooling",0.78,19],["Stock I","power",0.71,15],["Stock J","memory",0.66,12]],
  weeks: [ // id, kind, n, start (Mon), close day, value at the close, change £ on the week, order dates in the week
    {id:"l1",kind:"live",n:1,start:"2026-10-05",close:"2026-10-09",value:null,chg:null,orders:["2026-10-05"]},
    {id:"p4",kind:"practice",n:4,start:"2026-09-28",close:"2026-10-02",value:null,chg:null,orders:["2026-09-28"]},
    {id:"p3",kind:"practice",n:3,start:"2026-09-21",close:"2026-09-25",value:null,chg:null,orders:["2026-09-21"]},
    {id:"p2",kind:"practice",n:2,start:"2026-09-14",close:"2026-09-18",value:null,chg:null,orders:["2026-09-14"]},
    {id:"p1",kind:"practice",n:1,start:"2026-09-07",close:"2026-09-11",value:null,chg:null,orders:["2026-09-07"]}
  ]
};
