import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

// Deterministic population. Change SEED to generate a different town.
const SEED = 20261024;
let rngState = SEED >>> 0;
function random(): number { rngState = (1664525 * rngState + 1013904223) >>> 0; return rngState / 4294967296; }
function int(lo: number, hi: number): number { return lo + Math.floor(random() * (hi - lo + 1)); }
function pick<T>(xs: readonly T[]): T { return xs[int(0, xs.length - 1)]!; }
function normal(): number { return Math.sqrt(-2 * Math.log(Math.max(random(), 1e-9))) * Math.cos(2 * Math.PI * random()); }
function trait(): number { return Math.round(Math.min(1, Math.max(0, 0.5 + 0.18 * normal())) * 100) / 100; }
function unique<T>(items: readonly T[], n: number): T[] { const copy = [...items]; const out: T[] = []; while (out.length < n && copy.length) out.push(copy.splice(int(0, copy.length-1), 1)[0]!); return out; }

export type Relation = 'spouse' | 'parent' | 'child' | 'sibling';
export type Mood = 'neutral' | 'happy' | 'stressed' | 'sad' | 'excited' | 'angry' | 'calm';
export interface BigFive { openness: number; conscientiousness: number; extraversion: number; agreeableness: number; neuroticism: number; }
export interface Memory { id: string; tick: number; text: string; importance: number; tags: string[]; }
export interface Persona {
  id: string; householdId: string; name: string; age: number; gender: string; occupation: string;
  education: string; hometown: string; personality: BigFive; values: string[]; quirks: string[];
  backstory: string; speechStyle: string;
  family: Record<string, Relation>; friends: Record<string, number>;
  mood: Mood; goals: string[]; money: number; location: string;
  memories: Memory[]; beliefs: string[];
}
export interface Household { id: string; surname: string; address: string; memberIds: string[]; }
export interface World { schemaVersion: 1; seed: number; town: string; tick: number; households: Household[]; personas: Persona[]; }

const cultures = [
  { surname:'Okafor', first:['Adaeze','Chidi','Amara','Emeka','Nneka','Ifeanyi'], hometown:'Lagos, Nigeria' },
  { surname:'Patel', first:['Asha','Ravi','Priya','Neel','Kiran','Anika'], hometown:'Ahmedabad, India' },
  { surname:'Garcia', first:['Sofia','Mateo','Lucia','Diego','Camila','Elena'], hometown:'San Antonio, Texas' },
  { surname:'Kim', first:['Hana','Joon','Minji','Daniel','Yuna','Jiho'], hometown:'Seoul, South Korea' },
  { surname:'Nguyen', first:['Linh','Anh','Mai','Bao','Thao','Minh'], hometown:'Da Nang, Vietnam' },
  { surname:'Johnson', first:['Avery','James','Maya','Noah','Taylor','Olivia'], hometown:'Detroit, Michigan' },
  { surname:'Haddad', first:['Leila','Samir','Nadia','Omar','Mariam','Karim'], hometown:'Beirut, Lebanon' },
  { surname:'Chen', first:['Mei','Wei','Lian','Jun','Xinyi','Bo'], hometown:'Taipei, Taiwan' },
  { surname:'Reyes', first:['Isabel','Luis','Marisol','Nico','Gabriela','Rafael'], hometown:'Manila, Philippines' },
  { surname:'Thompson', first:['Jordan','Morgan','Harper','Elliot','Riley','Quinn'], hometown:'Portland, Oregon' },
  { surname:'Martinez', first:['Ana','Carlos','Valeria','Hector','Rosa','Pablo'], hometown:'Mexico City, Mexico' },
  { surname:'Mensah', first:['Akosua','Kwame','Esi','Kojo','Abena','Kofi'], hometown:'Accra, Ghana' },
  { surname:'Ali', first:['Fatima','Yusuf','Samira','Idris','Layla','Zain'], hometown:'Karachi, Pakistan' },
  { surname:'Silva', first:['Beatriz','Tiago','Ines','Gabriel','Clara','Rui'], hometown:'Lisbon, Portugal' },
  { surname:'Brown', first:['Charlie','Alex','Parker','Robin','Casey','Jamie'], hometown:'Chicago, Illinois' },
  { surname:'Williams', first:['Imani','Darius','Nia','Malik','Zoe','Micah'], hometown:'Atlanta, Georgia' },
  { surname:'Sato', first:['Yuki','Hiro','Emi','Ren','Aoi','Kenji'], hometown:'Osaka, Japan' },
  { surname:'Kowalski', first:['Anna','Piotr','Maja','Tomasz','Zofia','Jan'], hometown:'Krakow, Poland' },
  { surname:'Dubois', first:['Claire','Julien','Amelie','Leo','Manon','Hugo'], hometown:'Montreal, Canada' },
  { surname:'Tesfaye', first:['Hana','Dawit','Selam','Yonas','Mimi','Eden'], hometown:'Addis Ababa, Ethiopia' },
];
const jobs = ['nurse','software engineer','school teacher','librarian','mechanic','chef','social worker','electrician','shop owner','bus driver','paramedic','graphic designer','research scientist','gardener','accountant','community organizer','photographer','carpenter','pharmacist','journalist','dentist','delivery driver','artist','bakery owner','data analyst','city planner','firefighter','fitness coach','musician','real estate agent'];
const elderJobs = ['retired teacher','retired engineer','retired nurse','retired shopkeeper','retired librarian','retired mechanic'];
const values = ['family','curiosity','faith','creativity','service','stability','ambition','honesty','community','independence','justice','tradition','learning','kindness','security','adventure','environment','craftsmanship'];
const quirks = ['hums while thinking','keeps a handwritten planner','collects unusual postcards','talks to houseplants','always arrives early','drinks tea at sunset','uses colorful sticky notes','makes elaborate playlists','takes photos of clouds','taps a pencil when worried','bakes for neighbors','memorizes trivia','wears mismatched socks','checks the weather obsessively','names every bicycle','keeps ticket stubs','writes letters by hand','speaks in movie references','sketches on napkins','organizes community potlucks'];
const styles = ['warm, thoughtful, and measured','blunt with dry humor','energetic and quick to joke','soft-spoken and precise','storytelling with vivid details','direct and pragmatic','gentle with frequent questions','witty and slightly sarcastic','calm and reassuring','enthusiastic with short sentences'];
const places = ['Maple Street','River Road','Birch Avenue','Cedar Lane','Oak Drive','Willow Court'];

function persona(id: string, householdId: string, first: string, surname: string, age: number, hometown: string): Persona {
  const occupation = age < 5 ? 'preschooler' : age < 18 ? 'student' : age < 23 && random() < .6 ? 'college student' : age >= 67 ? pick(elderJobs) : pick(jobs);
  const education = age < 5 ? 'early childhood' : age < 18 ? 'school student' : age < 23 ? pick(['high school','some college','undergraduate student']) : pick(['high school diploma','trade certification','associate degree','bachelor degree','master degree','doctorate']);
  const personality = { openness:trait(), conscientiousness:trait(), extraversion:trait(), agreeableness:trait(), neuroticism:trait() };
  const pvalues = unique(values, 3); const pquirks = unique(quirks, 2);
  const motivation = age < 18 ? 'finding their place at school and in the neighborhood' : age >= 67 ? 'sharing hard-earned experience while enjoying a quieter rhythm' : `balancing work as a ${occupation} with personal commitments`;
  return {
    id, householdId, name:`${first} ${surname}`, age, gender:pick(['woman','man','nonbinary']), occupation, education, hometown,
    personality, values:pvalues, quirks:pquirks,
    backstory:`${first} has roots in ${hometown} and now lives in Millbrook. ${first} spends much of the week ${motivation}. Friends know ${first} for ${pquirks[0]} and for caring about ${pvalues[0]}. Life in Millbrook has given ${first} a new reason to invest in the local community.`,
    speechStyle:pick(styles), family:{}, friends:{}, mood:'neutral',
    goals:age < 18 ? ['build friendships','learn a new skill'] : age >= 67 ? ['stay connected to neighbors','pass on experience'] : [`grow as a ${occupation}`,'make time for loved ones'],
    money:age < 18 ? int(5,100) : age >= 67 ? int(100,9000) : int(200,15000), location:'home', memories:[], beliefs:[]
  };
}

function connect(a: Persona, b: Persona, ab: Relation, ba: Relation): void {
  if (a.id === b.id) throw new Error('Self family edge');
  a.family[b.id] = ab; b.family[a.id] = ba;
}
function householdPattern(): number[] {
  // Exact 50 residents; 19 households with a mix of single, shared, multigenerational and families.
  return [4,3,2,1,5,2,3,1,4,2,3,1,4,2,3,2,3,3,2];
}
function createWorld(): World {
  const households: Household[] = [], personas: Persona[] = [];
  const patterns = householdPattern();
  patterns.forEach((size, hIndex) => {
    const culture = cultures[hIndex]!;
    const householdId = `house_${String(hIndex+1).padStart(2,'0')}`;
    const household: Household = { id:householdId, surname:culture.surname, address:`${100+ hIndex * 7} ${pick(places)}, Millbrook`, memberIds:[] };
    households.push(household);
    const adultCount = size === 1 ? 1 : size === 2 ? (random()<.25 ? 1:2) : 2;
    const parentAges = [int(29,61), int(29,61)];
    // Adults with a plausible age gap; occasional older households for age diversity.
    if (hIndex === 7 || hIndex === 15) { parentAges[0] = int(68,81); parentAges[1] = int(66,80); }
    else parentAges[1] = Math.max(24, Math.min(65, parentAges[0]!+int(-7,7)));
    const adults: Persona[] = [], children: Persona[] = [];
    for (let i=0; i<size; i++) {
      const age = i<adultCount ? parentAges[i]! : Math.min(17, Math.max(0, Math.min(...parentAges.slice(0,adultCount))-int(20,40)));
      const name = culture.first[i % culture.first.length]!;
      const p = persona(`agent_${String(personas.length+1).padStart(2,'0')}`,householdId,name,culture.surname,age,culture.hometown);
      personas.push(p); household.memberIds.push(p.id);
      (i<adultCount ? adults : children).push(p);
    }
    if (adults.length === 2) connect(adults[0]!, adults[1]!, 'spouse','spouse');
    for (const child of children) for (const adult of adults) connect(adult,child,'parent','child');
    for(let i=0;i<children.length;i++) for(let j=i+1;j<children.length;j++) connect(children[i]!,children[j]!,'sibling','sibling');
    for (const p of [...adults,...children]) {
      const labels = Object.entries(p.family).map(([id,relation]) => `${personas.find(q=>q.id===id)?.name ?? id} (${relation})`);
      p.backstory = p.backstory.replace('Life in Millbrook has given', `${labels.length ? `At home, ${p.name.split(' ')[0]} shares life with ${labels.join(', ')}. ` : ''}Life in Millbrook has given`);
    }
  });
  // Friendship edges always reciprocal, with slight differences in subjective affection.
  for(let i=0;i<personas.length;i++) {
    for(let j=i+1;j<personas.length;j++) {
      const a=personas[i]!, b=personas[j]!;
      if (a.householdId === b.householdId || Math.abs(a.age-b.age)>26 || random()>.105) continue;
      const affinity=Math.round((.2+random()*.7)*100)/100;
      a.friends[b.id]=affinity; b.friends[a.id]=affinity;
    }
  }
  return { schemaVersion:1, seed:SEED, town:'Millbrook', tick:0, households, personas };
}

function verify(world: World): void {
  if(world.personas.length!==50) throw new Error(`Expected 50 residents; got ${world.personas.length}`);
  const map=new Map(world.personas.map(p=>[p.id,p]));
  if(map.size!==50) throw new Error('Duplicate IDs');
  const opposite: Record<Relation,Relation> = {spouse:'spouse',parent:'child',child:'parent',sibling:'sibling'};
  for(const h of world.households) for(const id of h.memberIds) if(map.get(id)?.householdId!==h.id) throw new Error('Household mismatch');
  for(const p of world.personas) {
    if(p.personality.openness<0 || p.personality.openness>1) throw new Error('Bad trait');
    for(const [id,rel] of Object.entries(p.family)) {
      const q=map.get(id); if(!q || q.family[p.id]!==opposite[rel]) throw new Error(`Broken family edge: ${p.id} -> ${id}`);
      if(rel==='parent' && p.age-q.age<18) throw new Error('Parent age gap invalid');
      if(rel==='child' && q.age-p.age<18) throw new Error('Child age gap invalid');
    }
    for(const id of Object.keys(p.friends)) if(!map.get(id)?.friends[p.id] && map.get(id)?.friends[p.id]!==0) throw new Error('Broken friendship edge');
  }
}

export function identityBlock(p:Persona, world: World): string {
  const map = new Map(world.personas.map(q=>[q.id,q]));
  const family=Object.entries(p.family).map(([id,rel])=>`${map.get(id)?.name ?? id} (${rel})`).join(', ') || 'none nearby';
  const traitWords = (Object.entries(p.personality) as [keyof BigFive,number][]).map(([k,v])=>{
    const labels:Record<keyof BigFive,[string,string]> = {
      openness:['traditional','curious and imaginative'], conscientiousness:['spontaneous','organized and dependable'],
      extraversion:['reserved','outgoing and talkative'], agreeableness:['skeptical and direct','cooperative and warm'],
      neuroticism:['emotionally steady','sensitive to stress']};
    return v>.65 ? labels[k][1] : v<.35 ? labels[k][0] : `moderately ${k}`;
  }).join(', ');
  return `You are ${p.name}, age ${p.age}, a ${p.occupation} in ${world.town}.\nBackground: ${p.backstory}\nFamily: ${family}\nPersonality: ${traitWords}\nValues: ${p.values.join(', ')}. Quirks: ${p.quirks.join(', ')}.\nSpeech: ${p.speechStyle}.\nMood: ${p.mood}. Goals: ${p.goals.join('; ')}.\nRelevant memories: ${p.memories.slice(-5).map(m=>m.text).join(' | ') || 'none yet'}.\nBeliefs: ${p.beliefs.join('; ') || 'none yet'}.\nStay in character. Do not contradict fixed facts.`;
}

export function interact(world:World, actorId:string, otherId:string, outcome:'positive'|'negative'|'neutral', note:string): void {
  const map=new Map(world.personas.map(p=>[p.id,p])); const a=map.get(actorId),b=map.get(otherId);
  if(!a || !b || a===b) throw new Error('Invalid interaction');
  const delta=outcome==='positive'?.06:outcome==='negative'?-.08:.005;
  const clamp=(v:number)=>Math.round(Math.max(-1,Math.min(1,v))*100)/100;
  a.friends[b.id]=clamp((a.friends[b.id] ?? 0)+delta);
  b.friends[a.id]=clamp((b.friends[a.id] ?? 0)+delta);
  for(const [p,other] of [[a,b],[b,a]] as const) {
    p.memories.push({id:`mem_${p.id}_${world.tick}_${p.memories.length+1}`, tick:world.tick, text:`Interaction with ${other.name}: ${note}`,importance:outcome==='negative'?.85:.6,tags:['social',outcome,other.id]});
    p.mood=outcome==='positive'?'happy':outcome==='negative'?'stressed':'neutral';
    if(p.memories.length%5===0) p.beliefs=[`Recent social encounters with ${other.name} have shaped my trust.`,...p.beliefs].slice(0,5);
  }
  world.tick++;
}

function saveJSON(world:World, file:string):void { writeFileSync(file,JSON.stringify(world,null,2)+'\n'); }
function saveSQLite(world:World,file:string):void {
  const db=new DatabaseSync(file);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS households (id TEXT PRIMARY KEY, surname TEXT NOT NULL, address TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS personas (id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id), name TEXT NOT NULL, age INTEGER NOT NULL, occupation TEXT NOT NULL, mood TEXT NOT NULL, location TEXT NOT NULL, data_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS relationships (from_id TEXT NOT NULL REFERENCES personas(id), to_id TEXT NOT NULL REFERENCES personas(id), type TEXT NOT NULL, affinity REAL, PRIMARY KEY(from_id,to_id,type));
    CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, persona_id TEXT NOT NULL REFERENCES personas(id), tick INTEGER NOT NULL, importance REAL NOT NULL, data_json TEXT NOT NULL);`);
  db.exec('BEGIN TRANSACTION');
  try {
    const insertH=db.prepare('INSERT OR REPLACE INTO households VALUES (?,?,?)');
    const insertP=db.prepare('INSERT OR REPLACE INTO personas VALUES (?,?,?,?,?,?,?,?)');
    const insertR=db.prepare('INSERT OR REPLACE INTO relationships VALUES (?,?,?,?)');
    const insertM=db.prepare('INSERT OR REPLACE INTO memories VALUES (?,?,?,?,?)');
    db.exec('DELETE FROM memories; DELETE FROM relationships; DELETE FROM personas; DELETE FROM households;');
    for(const h of world.households) insertH.run(h.id,h.surname,h.address);
    for(const p of world.personas) insertP.run(p.id,p.householdId,p.name,p.age,p.occupation,p.mood,p.location,JSON.stringify(p));
    for(const p of world.personas) {
      for(const [id,relation] of Object.entries(p.family)) insertR.run(p.id,id,relation,null);
      for(const [id,affinity] of Object.entries(p.friends)) insertR.run(p.id,id,'friend',affinity);
      for(const m of p.memories) insertM.run(m.id,p.id,m.tick,m.importance,JSON.stringify(m));
    }
    db.exec('COMMIT');
  } catch(e){db.exec('ROLLBACK');throw e;} finally {db.close();}
}

const dataDir=join(process.cwd(),'data'); mkdirSync(dataDir,{recursive:true});
const json=join(dataDir,'personas.json'), sqlite=join(dataDir,'personas.sqlite');
let world:World;
if(process.argv.includes('--simulate')) {
  world=JSON.parse(readFileSync(json,'utf8')) as World;
  interact(world,'agent_01','agent_06','positive','Helped repair a bicycle at the community fair.');
} else world=createWorld();
verify(world);
if(!process.argv.includes('--validate')) { saveJSON(world,json); saveSQLite(world,sqlite); }
console.log(`Valid ${world.personas.length}-resident world, ${world.households.length} households, tick=${world.tick}`);
console.log(world.personas.slice(0,5).map(p=>`${p.id}: ${p.name}, ${p.age}, ${p.occupation}`).join('\n'));
console.log(`JSON: ${json}\nSQLite: ${sqlite}`);
