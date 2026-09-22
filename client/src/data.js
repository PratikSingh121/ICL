export const teams=[
['falcons','IEM Falcons','FAL','#f5b941','Arjun Mehta',420000,580000,14,4,1,'+1.42',8],
['titans','Kolkata Titans','TIT','#50d5c3','Rohan Sen',275000,725000,15,3,2,'+0.63',6],
['royals','Techno Royals','ROY','#a98bff','Dev Kapoor',510000,490000,13,3,2,'+0.18',6],
['strikers','Salt Lake Strikers','SLS','#ff6b61','Kabir Das',190000,810000,16,2,3,'-0.24',4],
['warriors','IEM Warriors','WAR','#58a6ff','Vikram Roy',340000,660000,14,2,3,'-0.71',4],
['knights','New Town Knights','NTK','#f578b6','Sayan Paul',620000,380000,12,1,4,'-1.18',2]
].map(x=>Object.fromEntries(['id','name','short','color','captain','purse','spent','players','won','lost','nrr','points'].map((k,i)=>[k,x[i]])))

export const players=[
['aryan','Aryan Bose','All-rounder','RHB · Right-arm off break','Marquee',9.2,185000,'IEM Falcons',327,12,148.6,'AB'],
['ritwik','Ritwik Ghosh','Batter','LHB · Top order','Premium',8.8,145000,'Kolkata Titans',412,0,153.2,'RG'],
['ishan','Ishan Dutta','Bowler','RHB · Right-arm fast','Premium',8.7,120000,'Techno Royals',48,19,108.1,'ID'],
['neel','Neel Banerjee','Wicketkeeper','RHB · Middle order','Regular',8.1,95000,'Salt Lake Strikers',286,0,139.7,'NB'],
['aditya','Aditya Saha','All-rounder','LHB · Left-arm orthodox','Emerging',7.9,75000,'IEM Warriors',214,11,134.8,'AS'],
['shouvik','Shouvik Nandi','Bowler','RHB · Leg break','Regular',7.7,70000,'New Town Knights',29,16,96.4,'SN']
].map(x=>Object.fromEntries(['id','name','role','style','category','rating','price','team','runs','wickets','sr','avatar'].map((k,i)=>[k,x[i]])))

export const fixtures=[
{id:1,date:'24 SEP',time:'4:00 PM',venue:'IEM Main Ground',a:'FAL',b:'TIT',round:'League · Match 16'},
{id:2,date:'25 SEP',time:'3:30 PM',venue:'NKDA Cricket Ground',a:'ROY',b:'SLS',round:'League · Match 17'},
{id:3,date:'26 SEP',time:'4:00 PM',venue:'IEM Main Ground',a:'WAR',b:'NTK',round:'League · Match 18'}]
export const recentMatches=[
{id:21,status:'FAL won by 18 runs',a:'FAL',as:'176/6',b:'ROY',bs:'158/9',date:'Yesterday · Match 15'},
{id:20,status:'TIT won by 6 wickets',a:'SLS',as:'142/8',b:'TIT',bs:'146/4',date:'20 Sep · Match 14'},
{id:19,status:'WAR won in Super Over',a:'WAR',as:'164/7',b:'NTK',bs:'164/8',date:'19 Sep · Match 13'}]
export const auctionBids=[
{team:'Kolkata Titans',amount:145000,time:'2 sec ago',color:'#50d5c3'},
{team:'IEM Falcons',amount:135000,time:'7 sec ago',color:'#f5b941'},
{team:'Kolkata Titans',amount:125000,time:'11 sec ago',color:'#50d5c3'},
{team:'Techno Royals',amount:115000,time:'18 sec ago',color:'#a98bff'}]
export const money=v=>`₹${Number(v||0).toLocaleString('en-IN')}`
