import pg from "pg"; import fs from "fs"; import jwt from "jsonwebtoken";
const env=Object.fromEntries(fs.readFileSync(".env","utf8").split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")]}));
const c=new pg.Client({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}}); await c.connect();
const u=(await c.query(`select u.id,u.email,u.role,u.company_id,co.name from users u join companies co on co.id=u.company_id where co.name='Cabletvshop' and u.role='admin' limit 1`)).rows[0];
await c.end();
console.log(`acting as: ${u.email} role=${u.role} company=${u.name}`);
const tok=jwt.sign({userId:u.id,companyId:u.company_id,role:u.role,email:u.email}, env.JWT_SECRET, {expiresIn:"1d"});
for(const path of ["/api/automation-settings","/api/automation-settings/progressive"]){
  const r=await fetch("http://localhost:3114"+path,{headers:{cookie:`crm_session=${tok}`}});
  const txt=await r.text();
  console.log(`\n${path}\n  HTTP ${r.status} ${r.headers.get("content-type")}`);
  console.log("  body: "+txt.slice(0,300));
}
