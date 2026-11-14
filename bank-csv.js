(function(root){
'use strict';
function split(text,delimiter){
  var rows=[],row=[],field='',quoted=false;
  text=String(text).replace(/^\uFEFF/,'');
  for(var i=0;i<text.length;i++){
    var c=text[i];
    if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
    else if(c===delimiter&&!quoted){row.push(field);field='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(function(x){return x.trim();}))rows.push(row);row=[];field='';}
    else field+=c;
  }
  if(quoted)throw Error('Nicht geschlossenes Anführungszeichen in CSV.');
  row.push(field);if(row.some(function(x){return x.trim();}))rows.push(row);
  return rows;
}
function parseCSV(text){
  var first=String(text).replace(/^\uFEFF/,'').split(/\r?\n/)[0]||'';
  var candidates=[';',',','\t'],best=';',score=-1;
  candidates.forEach(function(d){var n=split(first,d)[0].length;if(n>score){score=n;best=d;}});
  var rows=split(text,best);
  if(rows.length<2||rows[0].length<2)throw Error('CSV enthält keine auswertbare Tabelle.');
  return {headers:rows[0].map(function(h){return h.trim();}),rows:rows.slice(1).filter(function(r){return r.some(function(v){return v.trim();});})};
}
function norm(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');}
function detect(headers){
  var h=headers.map(norm);
  function pick(names){for(var j=0;j<names.length;j++){var n=norm(names[j]),idx=h.indexOf(n);if(idx>=0)return idx;}return -1;}
  return {date:pick(['Buchungstag','Buchungsdatum','Datum','Booking Date','Date']),amount:pick(['Betrag','Betrag (EUR)','Umsatz','Amount']),purpose:pick(['Verwendungszweck','Buchungstext','Beschreibung','Purpose','Description']),party:pick(['Beguenstigter/Zahlungspflichtiger','Begünstigter/Zahlungspflichtiger','Empfaenger','Empfänger','Auftraggeber','Name Zahlungsbeteiligter','Name']),valueDate:pick(['Wertstellung','Valutadatum','Value Date'])};
}
function date(s){
  var m=String(s||'').trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if(!m){m=String(s||'').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);if(m)m=[m[0],m[3],m[2],m[1]];}
  if(!m)return null;
  var d=new Date(Date.UTC(+m[3],+m[2]-1,+m[1]));
  return d.getUTCFullYear()===+m[3]&&d.getUTCMonth()===+m[2]-1&&d.getUTCDate()===+m[1]?m[3]+'-'+m[2]+'-'+m[1]:null;
}
function amount(s){
  var t=String(s||'').replace(/[€\s\u00a0]/g,'').replace(/[^\d,.-]/g,'');
  if(!t)return NaN;
  if(t.includes(','))t=t.replace(/\./g,'').replace(',','.');
  else if(/^[-]?\d{1,3}(\.\d{3})+$/.test(t))t=t.replace(/\./g,'');
  var n=Number(t);return Number.isFinite(n)?Math.round(n*100)/100:NaN;
}
function fingerprint(r){return [r.konto,r.buchungsdatum,r.betrag.toFixed(2),r.verwendungszweck.toLowerCase().replace(/\s+/g,' ').trim(),r.gegenpartei.toLowerCase().replace(/\s+/g,' ').trim()].join('|');}
function prepare(parsed,mapping,konto){
  var result=[],errors=[],seen=new Set();
  parsed.rows.forEach(function(c,i){
    var d=date(c[mapping.date]),a=amount(c[mapping.amount]);
    if(!d||!Number.isFinite(a)){errors.push('Zeile '+(i+2)+': Datum oder Betrag ungültig');return;}
    var r={konto:konto,buchungsdatum:d,betrag:a,verwendungszweck:String(mapping.purpose>=0?c[mapping.purpose]||'':'').trim().slice(0,2000),gegenpartei:String(mapping.party>=0?c[mapping.party]||'':'').trim().slice(0,500)};
    r.import_key=fingerprint(r);
    if(seen.has(r.import_key))return;
    seen.add(r.import_key);result.push(r);
  });
  return {rows:result,errors:errors};
}
root.BankCSV={parseCSV:parseCSV,detect:detect,prepare:prepare,date:date,amount:amount};
})(typeof window!=='undefined'?window:this);
