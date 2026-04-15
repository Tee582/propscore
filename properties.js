import { getStore } from "@netlify/blobs";

function calcScores(d) {
  const n = (k) => { const v = parseFloat(d[k]); return isNaN(v) ? null : v; };
  const b = (k) => d[k] === "yes" || d[k] === true ? true : d[k] === "no" || d[k] === false ? false : null;
  const avg = (arr) => { const v = arr.filter(x => x !== null); return v.length ? v.reduce((a,b)=>a+b,0)/v.length : null; };
  const r = (v) => v !== null ? Math.round(v * 100) / 100 : null;

  const vac=n("vacancy_rate"), dsr=n("dsr"), dom=n("days_on_market"), stk=n("stock_on_market"), si=n("search_interest");
  const yld=n("gross_yield"), gTri=n("growth_triangulated"), rent36=n("rental_growth_36m");
  const t10=n("ten_year_growth"), hhi=b("household_income_above_avg"), pro=b("professional_occ_above_avg");
  const disc=n("vendor_discount"), bld=n("building_approvals"), stat=n("statistical_reliability"), land=d["land_supply"]||null;
  const raff=n("rent_affordability"), maff=n("mortgage_affordability");

  const score_demand = avg([
    vac!=null?(vac<0.5?10:vac<1?8:vac<2?5:vac<3?3:1):null,
    dsr!=null?(dsr>=70?10:dsr>=60?8:dsr>=50?6:dsr>=40?4:2):null,
    dom!=null?(dom<20?10:dom<30?8:dom<45?6:dom<60?4:2):null,
    stk!=null?(stk<0.3?10:stk<0.5?8:stk<1?6:stk<1.5?4:2):null,
    si!=null?(si>=100?10:si>=70?8:si>=50?6:si>=30?4:2):null,
  ]);
  const score_returns = avg([
    yld!=null?(yld>=7?10:yld>=6?8:yld>=5?6:yld>=4?4:2):null,
    gTri!=null?(gTri>=50?10:gTri>=40?8:gTri>=30?6:gTri>=20?5:gTri>=10?3:1):null,
    rent36!=null?(rent36>=25?10:rent36>=20?8:rent36>=15?6:rent36>=10?4:2):null,
  ]);
  const score_growth = avg([
    t10!=null?(t10>=12?10:t10>=10?8:t10>=8?6:t10>=6?4:2):null,
    hhi!=null?(hhi?10:3):null,
    pro!=null?(pro?10:3):null,
  ]);
  const score_risk = avg([
    disc!=null?(disc<-2?10:disc<0?8:disc<2?5:disc<4?3:1):null,
    bld!=null?(bld<1?10:bld<2?8:bld<3?5:bld<4?3:1):null,
    stat!=null?(stat>=70?10:stat>=60?8:stat>=50?6:stat>=40?4:2):null,
    land?(land==="limited"?8:land==="developing"?6:3):null,
  ]);
  const score_affordability = avg([
    raff!=null?(raff>=60?10:raff>=50?8:raff>=40?6:4):null,
    maff!=null?(maff>=80?10:maff>=70?8:maff>=60?6:4):null,
  ]);

  const all = [score_demand,score_returns,score_growth,score_risk,score_affordability].filter(x=>x!==null);
  const score_overall = all.length ? all.reduce((a,b)=>a+b,0)/all.length : null;

  return { score_demand:r(score_demand), score_returns:r(score_returns), score_growth:r(score_growth), score_risk:r(score_risk), score_affordability:r(score_affordability), score_overall:r(score_overall) };
}

function nextId(list) {
  return list.length ? Math.max(...list.map(p=>p.id||0))+1 : 1;
}

export default async (req) => {
  const store = getStore({ name: "properties", consistency: "strong" });
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/properties\/?/,"").split("/").filter(Boolean);
  const id = parts[0] ? parseInt(parts[0]) : null;

  try {
    if (req.method === "GET") {
      const data = await store.get("all", { type: "json" });
      let list = data || [];
      if (id) {
        const item = list.find(p=>p.id===id);
        if (!item) return new Response(JSON.stringify({error:"Not found"}),{status:404,headers:{"Content-Type":"application/json"}});
        return new Response(JSON.stringify(item),{headers:{"Content-Type":"application/json"}});
      }
      const sortBy = url.searchParams.get("sort")||"created_at";
      const order = url.searchParams.get("order")==="asc"?1:-1;
      list.sort((a,b)=>{ const av=a[sortBy]??"",bv=b[sortBy]??""; return av<bv?-order:av>bv?order:0; });
      return new Response(JSON.stringify(list),{headers:{"Content-Type":"application/json"}});
    }

    if (req.method === "POST") {
      const body = await req.json();
      const data = await store.get("all",{type:"json"});
      const list = data||[];
      const item = {...body,...calcScores(body),id:nextId(list),created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
      list.push(item);
      await store.setJSON("all",list);
      return new Response(JSON.stringify(item),{status:201,headers:{"Content-Type":"application/json"}});
    }

    if (req.method === "PUT" && id) {
      const body = await req.json();
      const data = await store.get("all",{type:"json"});
      const list = data||[];
      const idx = list.findIndex(p=>p.id===id);
      if (idx===-1) return new Response(JSON.stringify({error:"Not found"}),{status:404,headers:{"Content-Type":"application/json"}});
      list[idx] = {...list[idx],...body,...calcScores(body),id,updated_at:new Date().toISOString()};
      await store.setJSON("all",list);
      return new Response(JSON.stringify(list[idx]),{headers:{"Content-Type":"application/json"}});
    }

    if (req.method === "DELETE" && id) {
      const data = await store.get("all",{type:"json"});
      const list = (data||[]).filter(p=>p.id!==id);
      await store.setJSON("all",list);
      return new Response(JSON.stringify({success:true}),{headers:{"Content-Type":"application/json"}});
    }

    return new Response(JSON.stringify({error:"Method not allowed"}),{status:405,headers:{"Content-Type":"application/json"}});
  } catch(err) {
    console.error(err);
    return new Response(JSON.stringify({error:err.message}),{status:500,headers:{"Content-Type":"application/json"}});
  }
}

export const config = {
  path: ["/api/properties", "/api/properties/*"]
};
