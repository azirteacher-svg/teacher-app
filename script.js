(() => {
  const STORAGE_KEY = 'teacher-grade-analysis-v2';
  const GRADE_ORDER = ['F','E','D','C','B','A'];
  const GRADE_VALUE = {F:0,E:1,D:2,C:3,B:4,A:5};
  const state = loadState();
  let activeTestId = state.settings.activeTestId || null;

  function emptyState(){ return {students:[], ntTests:[], assessments:[], settings:{activeTestId:null}}; }
  function loadState(){ try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || emptyState(); } catch(e){ return emptyState(); } }
  function saveState(){ try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch(e){ alert('The browser could not save data. Please use Export Backup often.'); } }
  function id(prefix){ return prefix + '-' + Date.now() + '-' + Math.floor(Math.random()*100000); }
  function norm(v){ return (v ?? '').toString().trim(); }
  function toNumber(v){ const n = parseFloat((v ?? '').toString().replace(',', '.')); return Number.isFinite(n) ? n : null; }
  function cleanGrade(v){ const g = norm(v).toUpperCase(); return GRADE_VALUE.hasOwnProperty(g) ? g : (g || ''); }
  function cleanGender(v){
    const g = norm(v).toLowerCase();
    if(!g) return '';
    if(['g','girl','girls','female','flicka','flickor','kvinna'].includes(g)) return 'Female';
    if(['b','boy','boys','male','pojke','pojkar','man'].includes(g)) return 'Male';
    return norm(v);
  }
  function gradeDiff(a,b){ a=cleanGrade(a); b=cleanGrade(b); if(!GRADE_VALUE.hasOwnProperty(a)||!GRADE_VALUE.hasOwnProperty(b)) return null; return GRADE_VALUE[b]-GRADE_VALUE[a]; }
  function diffText(d){ if(d===null) return '-'; if(d===0) return 'Same'; return d>0 ? `Up +${d}` : `Down ${d}`; }
  function escapeHtml(s){ return norm(s).replace(/[&<>'"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function csvEscape(v){ const s = (v ?? '').toString(); return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; }
  function downloadFile(name, text, type='text/plain'){ const blob = new Blob([text], {type}); const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); }

  function detectDelimiter(text){
    const sample = text.split(/\r?\n/).slice(0,5).join('\n');
    const candidates=[',',';','\t'];
    return candidates.map(d=>({d, n:(sample.match(new RegExp(d==='\t'?'\t':d,'g'))||[]).length})).sort((a,b)=>b.n-a.n)[0].d || ',';
  }
  function parseCsv(text){
    text = (text || '').replace(/^\uFEFF/, '');
    const delimiter = detectDelimiter(text);
    const rows=[]; let row=[], cur='', q=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i], next=text[i+1];
      if(q){ if(ch==='"' && next==='"'){cur+='"'; i++;} else if(ch==='"'){q=false;} else cur+=ch; }
      else { if(ch==='"') q=true; else if(ch===delimiter){row.push(cur); cur='';} else if(ch==='\n'){row.push(cur); rows.push(row); row=[]; cur='';} else if(ch==='\r'){} else cur+=ch; }
    }
    if(cur || row.length) { row.push(cur); rows.push(row); }
    return rows.map(r=>r.map(c=>norm(c))).filter(r=>r.some(c=>norm(c)));
  }
  async function readRows(file){
    const name=file.name.toLowerCase();
    if((name.endsWith('.xlsx') || name.endsWith('.xls')) && typeof readXlsxFile === 'function') return await readXlsxFile(file);
    if(name.endsWith('.xlsx') || name.endsWith('.xls')) throw new Error('Excel reader could not load. Please save the file as CSV and upload again.');
    return parseCsv(await file.text());
  }

  function upsertStudent(name, gender='', section=''){
    name=norm(name); if(!name) return;
    const key=name.toLowerCase();
    const cleanedGender = cleanGender(gender);
    let s=state.students.find(x=>x.name.toLowerCase()===key);
    if(!s){ s={id:id('stu'), name, gender:cleanedGender, section:norm(section)}; state.students.push(s); }
    else { if(cleanedGender) s.gender=cleanedGender; if(section) s.section=norm(section); }
  }
  function getStudent(name){ return state.students.find(s=>s.name.toLowerCase()===norm(name).toLowerCase()); }
  function selectedTest(){
    if(activeTestId === 'all') return aggregateAllTests();
    return state.ntTests.find(t=>t.id===activeTestId) || state.ntTests[0] || null;
  }

  function aggregateAllTests(){
    if(!state.ntTests.length) return null;
    const qMap = new Map();
    state.ntTests.forEach(t=>{
      (t.questions||[]).forEach(q=>{
        const k = questionKey(q.label);
        if(!qMap.has(k)) qMap.set(k, {...q, col: undefined});
      });
    });
    const questions = Array.from(qMap.values());
    const students = [];
    state.ntTests.forEach(t=>{
      const indexByKey = {};
      (t.questions||[]).forEach((q,i)=>{ indexByKey[questionKey(q.label)] = i; });
      (t.students||[]).forEach(r=>{
        const scores = questions.map(q=>{
          const original = r.scores?.[indexByKey[questionKey(q.label)]];
          return original ? {...original} : {label:q.label, max:q.max, score:null, topic:q.topic||'General', questionType:q.questionType||'', skill:q.skill||'', knowledgeArea:q.knowledgeArea||'', level:q.level||'', notes:q.notes||'', part:q.part||''};
        });
        students.push({...r, scores, sourceTestId:t.id, sourceTestTitle:t.title, sourceClass:t.className || ''});
      });
    });
    return {
      id:'all',
      isAggregate:true,
      title:'All National Tests / All Classes',
      subject:'National Test',
      className:'All',
      questions,
      students,
      maxTotal: questions.reduce((a,q)=>a+Number(q.max||0),0)
    };
  }
  function getFilteredRows(test){
    if(!test) return [];
    const sec=document.getElementById('sectionFilter')?.value || 'all';
    const gen=document.getElementById('genderFilter')?.value || 'all';
    return test.students.filter(r=>{
      const stu=getStudent(r.name) || {};
      if(sec!=='all' && (stu.section || test.className || '') !== sec) return false;
      if(gen!=='all' && (stu.gender || 'Unspecified') !== gen) return false;
      return true;
    });
  }

  function parseNationalTestRows(rows){
    if(rows.length < 3) throw new Error('The file must contain at least max point row, header row, and student rows.');
    const maxRow = rows[0];
    const headerRow = rows[1];
    const nameIndex = headerRow.findIndex(c => norm(c).toLowerCase()==='name');
    if(nameIndex === -1) throw new Error('Could not find the Name column in row 2.');
    const lowHeaders = headerRow.map(c=>norm(c).toLowerCase());
    const genderIndex = lowHeaders.findIndex((h,i)=>i>nameIndex && ['gender','sex','kön','kon'].includes(h));
    const firstSummary = lowHeaders.findIndex((h,i)=>i>nameIndex && ['total','total ','nt grade','teacher grade','final grade','deviations','reason'].some(x=>h===x || h.includes(x.trim())));
    const questionEnd = firstSummary === -1 ? headerRow.length : firstSummary;
    const questions=[];
    for(let c=nameIndex+1; c<questionEnd; c++){
      const label = norm(headerRow[c]);
      if(!label) continue;
      const max = toNumber(maxRow[c]);
      if(max===null) continue;
      questions.push({col:c, label, max, topic:'General', questionType:'', skill:'', knowledgeArea:'', level:'', notes:'', part:''});
    }
    // Summary columns can have different names in your spreadsheets.
    // Example from your 9B file: Total, Grade, Teacher Grade, Deviations, Reason, Final Grade, Deviations, Motivation.
    // Older app versions only looked for "NT Grade", so a plain "Grade" column was missed.
    const findColExact = (...names) => lowHeaders.findIndex(h => names.some(n => h === n));
    const findColIncludes = (...names) => lowHeaders.findIndex(h => names.some(n => h.includes(n)));
    const totalCol = findColIncludes('total','summa','poäng totalt','poang totalt');
    const teacherCol = findColIncludes('teacher grade','teacher','year grade','årsbetyg','arsbetyg');
    const finalCol = findColIncludes('final grade','final','slutbetyg');
    // NT grade is normally the first grade-like column after Total and before Teacher Grade.
    let ntCol = -1;
    for(let i=(totalCol>=0?totalCol+1:nameIndex+1); i<lowHeaders.length; i++){
      const h=lowHeaders[i];
      if(!h) continue;
      if(i===teacherCol || i===finalCol) continue;
      if(h==='grade' || h==='nt grade' || h==='national test grade' || h==='nationaltest grade' || h==='np grade' || h==='provbetyg' || h==='betyg'){ ntCol=i; break; }
      if(teacherCol>=0 && i>=teacherCol) break;
    }
    if(ntCol<0) ntCol=findColIncludes('nt grade','national test grade','np grade','provbetyg');
    const reasonCol = findColIncludes('reason','orsak');
    const motivationCol = findColIncludes('motivation','motivering');
    const cols = {
      total: totalCol,
      ntGrade: ntCol,
      teacherGrade: teacherCol,
      finalGrade: finalCol,
      reason: reasonCol,
      motivation: motivationCol
    };
    // If two Deviations columns exist, use first after NT/teacher and second after final when possible.
    const deviationCols = lowHeaders.map((h,i)=>(h.includes('deviation') || h.includes('avvik'))?i:-1).filter(i=>i>=0);
    cols.ntTeacherDeviation = deviationCols[0] ?? -1;
    cols.finalDeviation = deviationCols[1] ?? deviationCols[0] ?? -1;

    const students=[];
    for(let r=2; r<rows.length; r++){
      const row=rows[r]; const name=norm(row[nameIndex]); if(!name) continue;
      const scores = questions.map(q=>({label:q.label, max:q.max, score:toNumber(row[q.col]), topic:q.topic, questionType:q.questionType||'', skill:q.skill||'', knowledgeArea:q.knowledgeArea||'', level:q.level||'', notes:q.notes||'', part:q.part||''}));
      const totalFromScores = scores.reduce((a,s)=>a + (s.score ?? 0), 0);
      const total = toNumber(row[cols.total]) ?? totalFromScores;
      const gender = genderIndex >= 0 ? cleanGender(row[genderIndex]) : '';
      students.push({
        name, gender, scores, total,
        ntGrade: cleanGrade(row[cols.ntGrade]),
        teacherGrade: cleanGrade(row[cols.teacherGrade]),
        finalGrade: cleanGrade(row[cols.finalGrade]),
        ntTeacherDeviation: norm(row[cols.ntTeacherDeviation]),
        finalDeviation: norm(row[cols.finalDeviation]),
        reason: norm(row[cols.reason]),
        motivation: norm(row[cols.motivation])
      });
    }
    return {questions, students, maxTotal: questions.reduce((a,q)=>a+q.max,0)};
  }

  async function importNationalTest(){
    const f=document.getElementById('ntFile').files[0]; if(!f) return alert('Choose a National Test file first.');
    try{
      const parsed=parseNationalTestRows(await readRows(f));
      const title=norm(document.getElementById('ntTitle').value) || f.name.replace(/\.[^.]+$/,'');
      const subject=norm(document.getElementById('ntSubject').value) || 'National Test';
      const className=norm(document.getElementById('ntClass').value) || inferClassFromFile(f.name);
      const test={id:id('nt'), title, subject, className, importedAt:new Date().toISOString(), ...parsed};
      test.students.forEach(r=>upsertStudent(r.name, r.gender || '', className));
      state.ntTests.push(test);
      activeTestId=test.id;
      state.settings.activeTestId=activeTestId;
      // Auto-apply the built-in Kemi 2026 question mapping so topics and question types are not left as General/Unspecified.
      let autoMapped = 0;
      try { autoMapped = applyQuestionMappingRows(parseCsv(defaultKemiMappingCsv())); } catch(_) { autoMapped = 0; }
      saveState(); render();
      const genderCount = test.students.filter(s=>s.gender).length;
      const ntGradeCount = test.students.filter(s=>s.ntGrade).length;
      document.getElementById('ntImportStatus').textContent = `Imported ${test.students.length} students, ${test.questions.length} questions, max total ${test.maxTotal}. Gender imported for ${genderCount} students. NT grade imported for ${ntGradeCount} students. Question mapping auto-applied to ${autoMapped} questions.`;
    } catch(e){ alert(e.message); }
  }
  function inferClassFromFile(name){ const m=name.match(/\b(\d+[A-Z])\b/i); return m ? m[1].toUpperCase() : ''; }

  function questionKey(v){ return norm(v).toUpperCase().replace(/\s+/g,'').replace(/^Q/,''); }
  function mappingTemplateCsv(){
    const test=selectedTest();
    const header='Part,Question,Max Points,Topic,Question Type,Skill / Ability,Knowledge Area,E/C/A Level,Notes / What students needed to show';
    if(!test) return header + '\n';
    return [header].concat(test.questions.map(q=>[
      q.part||'', q.label, q.max, q.topic||'', q.questionType||'', q.skill||'', q.knowledgeArea||'', q.level||'', q.notes||''
    ].map(csvEscape).join(','))).join('\n');
  }

  function studentTemplateCsv(){
    return 'Name,Gender,Class/Section\nExample Student,Female,9A\nExample Boy,Male,9A';
  }
  function ntTemplateCsv(){
    return [
      ',,1,1,2,2,1,,,,',
      'Name,gender,1,2,3,4,5,Total,NT Grade,Teacher Grade,Final Grade,Reason,Motivation for the deviation',
      'Example Student,Female,1,1,2,2,1,7,C,C,C,,',
      'Example Boy,Male,0,1,1,1,0,3,F,E,E,Year evidence supports E,Good class work and practical work'
    ].join('\n');
  }
  function yearAssessmentTemplateCsv(){
    return 'Name,Assessment,Score,Max,Grade,Topic,Subject,Date\nExample Student,Unit test 1,18,25,C,Chemical reactions,Kemi,2026-05-31\nExample Boy,Lab report,12,20,E,Investigations,Kemi,2026-05-31';
  }
  function defaultKemiMappingCsv(){
    return `Part,Question,Max Points,Topic,Question Type,Skill / Ability,Knowledge Area,E/C/A Level,Notes / What students needed to show
A,1,1,States of matter and particle model,Matching / model interpretation,"Identify particle models for solid, liquid and gas",Matter and particle model,E,"Match solid, liquid and gas with the correct particle diagrams."
A,2,1,"Matter, atoms and compounds",Multiple choice / particle model,Recognise a chemical compound from particle diagrams,"Atoms, molecules and compounds",E,Choose the particle model that represents a chemical compound.
A,3,2,Chemical reactions,Multiple choice / select correct statements,Recognise what happens in a chemical reaction,Chemical reactions and energy,C,Select correct statements about atoms rearranging and energy/heat in chemical reactions.
A,4,2,"Fuels, combustion and particle movement",Written explanation,Explain why temperature affects ignition using particle movement,Combustion and energy,C,"Explain why ethanol ignites more easily when warm, using particle movement, collision and ignition temperature."
A,5,1,Vitamins and solubility,Written explanation,Connect solubility to risk in the human body,Chemistry in the human body,E,Explain why fat-soluble vitamins can build up in the body more than water-soluble vitamins.
A,6,2,Periodic table and atomic structure,Multiple choice / select correct statements,"Use protons, electrons and electron shells to compare elements",Atoms and periodic table,C,"Choose correct statements about He, O, F, Ne and electron shells/valence electrons."
A,7,1,"Biofuels, carbon dioxide and climate",Written reasoning,Explain carbon dioxide release and greenhouse effect,Environment and fuels,E,Explain why burning biofuel still releases carbon dioxide and can contribute to greenhouse effect.
A,8,1,Fats and esters,Multiple choice,Identify the alcohol involved in ester formation from fatty acids,Organic chemistry,E,Choose glycerol as the alcohol that reacts with fatty acids to form fats.
A,9,1,Raw materials and products,Matching,Match raw materials to products,Materials and resources,E,"Match oil, wood, limestone and iron ore to plastic, paper, cement and steel."
A,10A,1,Separation methods,Written method,Describe filtration as a method to separate an insoluble solid from salt water,Mixtures and separation,E,State that sand can be separated from salt water by filtering.
A,10B,1,Separation methods,Written method,Describe evaporation/crystallisation to recover salt from water,Mixtures and separation,E,State that salt can be separated by evaporation/boiling away water.
A,11,2,Enzymes and digestion,Written explanation,Explain enzyme function in digestion,Chemistry in the human body,C,State that pepsin breaks down proteins in the stomach.
A,12,1,Source evaluation and materials,Multiple choice / source evaluation,Choose a reliable source for material information,Sources and material knowledge,E,Choose the pottery shop website or a relevant source for information about the ceramic material.
A,13,1,Source criticism and scientific claims,Multiple choice / claim evaluation,Check whether advertising claims are scientifically correct,Source evaluation and environmental chemistry,E,Evaluate a mobile phone advert claim about carbon and electromagnetic radiation.
A,14A,2,Investigation method and reliability,Written evaluation,Explain one strength that makes a study reliable,Scientific investigations,C,Identify a strength such as repeated measurements or measuring before/after to support reliability.
A,14B,2,Investigation method and validity,Written evaluation,Explain a weakness that makes results less reliable/valid,Scientific investigations,C,Identify a weakness such as another factor affecting results or lack of control variables.
A,15,2,"Natural resources, clothing and environment",Written reasoning,Use environmental reasoning about reduced new clothing production,Sustainable development and materials,C,"Explain why fewer new clothes can reduce cotton use, transport, waste, water use or environmental impact."
A,16,3,"Fertilisers, environment and resources",Written reasoning using information,Compare natural fertiliser and artificial fertiliser using table evidence,"Agriculture, environment and chemistry",A,Use table information to reason in several steps why natural fertiliser may be better for the environment than artificial fertiliser.
A,17A,2,Nutrients: proteins,Written reasoning using table,Use food data to compare protein content and body function,Food chemistry and human body,C,Use the table to explain which food gives more protein and why protein is important for the body.
A,17B,2,Nutrients: minerals/fat/iron/calcium,Written reasoning using table,Use food data to compare another nutrient and body function,Food chemistry and human body,C,"Choose another nutrient from the table, compare values and explain why that nutrient is needed in the body."
B,18,1,Atomic model and subatomic particles,Matching / model interpretation,"Identify proton, neutron and electron in an atom model",Atoms and atomic structure,E,"Match particle A, B and C with proton, neutron and electron."
B,19,1,Chemical reactions vs physical changes,Multiple choice,Recognise an example of a chemical reaction,Chemical reactions,E,"Choose an example such as magnesium burning instead of melting, dissolving or boiling."
B,20,1,Chemical reactions and substances,Multiple choice / formula interpretation,Identify the missing substance in a reaction equation,Chemical reactions and equations,E,Use the reaction between iron oxide and another substance to identify the substance that forms water.
B,21,1,Metals and oxygen,Multiple choice,Identify the metal property shown by rusting,Materials and corrosion,E,Choose the property connected to metal reacting with oxygen / rusting.
B,22,1,Photosynthesis and carbon atoms,Multiple choice,Explain where carbon atoms in glucose come from,Photosynthesis and carbon cycle,E,Identify that carbon atoms come from carbon dioxide taken from the air.
B,23A,1,Biogas and uses,Short answer,Give a valid use of biogas,Fuels and sustainable energy,E,"Give one example of what biogas can be used for, such as fuel, heating, electricity or transport."
B,23B,2,Combustion products,Multiple choice / select correct substances,Identify substances formed during combustion,Combustion and fuels,C,Select carbon dioxide and water vapour as main products from burning biogas.
B,24,2,Proteins and body functions,Multiple choice / select correct statements,Recognise functions and properties of proteins,Chemistry in the human body,C,"Select correct statements about proteins, such as building amino acids/being needed for cells or hormones."
B,25,1,Absolute zero and particles,Written explanation,Explain absolute zero using particle movement,Particle model and temperature,E,Explain that at absolute zero particles have as little movement as possible / cannot be colder.
B,26A,1,"Acids, bases and pH",Multiple choice,Interpret pH using acid/base indicator,Acids and bases,E,State that the solution is acidic and pH is lower than 7 when litmus turns red.
B,26B,1,Neutralisation reaction,Written answer / formula interpretation,Identify water as a product in acid-base neutralisation,"Acids, bases and reactions",E,Identify substance A as water in HCl + NaOH → NaCl + water.
B,27,2,Balancing chemical equations,Calculation / equation balancing,Balance a combustion equation,Chemical reactions and equations,C,Fill in correct coefficients to balance propane combustion.
B,28,1,Hazard symbols,Multiple choice / symbol interpretation,Interpret a chemical hazard pictogram,Chemical safety,E,Identify the exclamation mark hazard symbol as harmful/irritant.
B,29,1,Hypothesis and solubility,Multiple choice / hypothesis,Choose a testable hypothesis with scientific reasoning,Scientific investigations,E,Choose a hypothesis that is testable and connected to solubility or particle properties.
B,30,3,Improving investigations: cleaning metal coating,Written evaluation,Evaluate a method and suggest improvements for reliability,Scientific investigations and materials,A,Use the described method to identify weaknesses and suggest improvements that make results more reliable.
B,31,3,Planning investigations: powders and fire,Written planning,Plan a fair and systematic investigation,Scientific investigations and fire chemistry,A,"Plan how to test whether baking powder or sand works best, including variables, safety, method and comparison."
B,32,2,Interpreting graphs: blood sugar,Written explanation from graph,Use a graph to compare starch and sugar effects on blood sugar,Food chemistry and diagrams,C,Explain why blood sugar changes differently after starch and sugar using the graph.
B,33,3,Evaluating results: solubility,Written explanation using data,Identify factors that could explain different results,Solubility and scientific reliability,A,"Explain at least two possible factors, such as temperature, amount of water, stirring, measurement or method differences."
B,34A,1,States of matter from melting/boiling diagram,Diagram interpretation,Use melting and boiling points to decide gas state at 100°C,Particle model and phase changes,E,Use the diagram to identify which substances are gases at 100°C.
B,34B,1,States of matter from melting/boiling diagram,Diagram interpretation,Use melting and boiling points to decide liquid state at −100°C,Particle model and phase changes,E,Use the diagram to identify which substances are liquids at −100°C.
`;
  }

  function applyQuestionMappingRows(rows){
    const test=selectedTest();
    if(!test) throw new Error('Import the National Test first, then upload the question mapping file.');
    if(!rows.length) throw new Error('The mapping file is empty.');
    const header=rows[0].map(h=>norm(h).toLowerCase());
    const find=(names, fallback)=>{ for(const n of names){ const i=header.findIndex(h=>h===n || h.includes(n)); if(i>=0) return i; } return fallback; };
    const idx={
      part:find(['part','delprov'],0),
      q:find(['question','fråga','fraga'],1),
      max:find(['max points','max','poäng','poang'],2),
      topic:find(['topic','område','omrade'],3),
      type:find(['question type','type','format','frågetyp','fragetyp'],4),
      skill:find(['skill','ability','förmåga','formaga'],5),
      area:find(['knowledge area','kunskapsområde','kunskapsomrade'],6),
      level:find(['level','e/c/a','grade level'],7),
      notes:find(['notes','needed','visa','show'],8)
    };
    let updated=0;
    rows.slice(1).forEach(r=>{
      const label=questionKey(r[idx.q]); if(!label) return;
      const q=test.questions.find(x=>questionKey(x.label)===label);
      if(!q) return;
      q.part=norm(r[idx.part]) || q.part || '';
      q.topic=norm(r[idx.topic]) || q.topic || 'General';
      q.questionType=norm(r[idx.type]) || q.questionType || '';
      q.skill=norm(r[idx.skill]) || q.skill || '';
      q.knowledgeArea=norm(r[idx.area]) || q.knowledgeArea || '';
      q.level=norm(r[idx.level]) || q.level || '';
      q.notes=norm(r[idx.notes]) || q.notes || '';
      const max=toNumber(r[idx.max]); if(max!==null) q.max=max;
      updated++;
    });
    test.students.forEach(r=>r.scores.forEach((score,i)=>{
      const q=test.questions[i]; if(!q) return;
      Object.assign(score,{topic:q.topic, questionType:q.questionType||'', skill:q.skill||'', knowledgeArea:q.knowledgeArea||'', level:q.level||'', notes:q.notes||'', part:q.part||''});
    }));
    test.maxTotal=test.questions.reduce((a,q)=>a+Number(q.max||0),0);
    return updated;
  }
  async function importQuestionMap(){
    const f=document.getElementById('questionMapFile').files[0]; if(!f) return alert('Choose a question mapping file first.');
    try{
      const rows=await readRows(f);
      const updated=applyQuestionMappingRows(rows);
      saveState(); render();
      $('#questionMapStatus').textContent=`Updated ${updated} questions with topic, type, skill and notes.`;
    } catch(e){ alert(e.message); }
  }


  async function importStudents(){
    const f=document.getElementById('studentFile').files[0]; if(!f) return alert('Choose a student file first.');
    try{
      const rows=await readRows(f);
      if(!rows.length) throw new Error('The student file is empty.');
      let start=0; const head=rows[0].map(x=>norm(x).toLowerCase());
      const hasHeader=head.some(h=>['name','student','student name','elev','namn'].includes(h));
      if(hasHeader) start=1;
      const find=(names, fallback)=>{ for(const n of names){ const i=head.findIndex(h=>h===n || h.includes(n)); if(i>=0) return i; } return fallback; };
      const nameIdx=hasHeader?find(['name','student name','student','elev','namn'],0):0;
      const genderIdx=hasHeader?find(['gender','sex','kön','kon'],1):1;
      const sectionIdx=hasHeader?find(['class','section','klass','group','grupp'],2):2;
      let count=0;
      rows.slice(start).forEach(r=>{ const name=norm(r[nameIdx]); if(name){ upsertStudent(name, r[genderIdx], r[sectionIdx]); count++; }});
      saveState(); render(); document.getElementById('studentFile').value=''; alert(`Imported ${count} students.`);
    } catch(e){ alert('Student import failed: '+e.message); }
  }
  async function importYear(){
    const f=document.getElementById('yearFile').files[0]; if(!f) return alert('Choose an assessment file first.');
    try{
      const rows=await readRows(f); if(!rows.length) throw new Error('The assessment file is empty.');
      const head=rows[0].map(x=>norm(x).toLowerCase());
      const hasHeader=head.some(h=>['name','student','score','max','assessment'].includes(h));
      const find=(names, fallback)=>{ for(const n of names){ const i=head.findIndex(h=>h===n || h.includes(n)); if(i>=0) return i; } return fallback; };
      const idx={name:hasHeader?find(['name','student','elev','namn'],0):0, title:hasHeader?find(['assessment','assignment','test','title','prov'],1):1, score:hasHeader?find(['score','points','poäng','poang'],2):2, max:hasHeader?find(['max','max points','maxpoäng','maxpoang'],3):3, grade:hasHeader?find(['grade','betyg'],4):4, topic:hasHeader?find(['topic','område','omrade'],5):5, subject:hasHeader?find(['subject','ämne','amne'],6):6, date:hasHeader?find(['date','datum'],7):7};
      let count=0;
      rows.slice(hasHeader?1:0).forEach(r=>{
        const name=norm(r[idx.name]); const score=toNumber(r[idx.score]); const max=toNumber(r[idx.max]);
        if(name && score!==null && max!==null && max>0){
          upsertStudent(name);
          state.assessments.push({id:id('ass'), name, title:norm(r[idx.title])||'Assessment', score, max, grade:cleanGrade(r[idx.grade]), topic:norm(r[idx.topic]), subject:norm(r[idx.subject]), date:norm(r[idx.date])});
          count++;
        }
      });
      saveState(); render(); document.getElementById('yearFile').value=''; $('#yearStatus').textContent=`Imported ${count} assessment rows.`;
    } catch(e){ alert('Assessment import failed: '+e.message); }
  }
  function addAssessment(){ const name=norm($('#manualAssessmentName').value), score=toNumber($('#manualAssessmentScore').value), max=toNumber($('#manualAssessmentMax').value); if(!name||score===null||!max) return alert('Name, score, and max are required.'); upsertStudent(name); state.assessments.push({id:id('ass'), name, title:norm($('#manualAssessmentTitle').value), score, max, grade:cleanGrade($('#manualAssessmentGrade').value), topic:norm($('#manualAssessmentTopic').value), subject:norm($('#manualAssessmentSubject').value), date:new Date().toISOString().slice(0,10)}); saveState(); render(); }
  function $(s){ return document.querySelector(s); }

  function studentYearAvg(name){ const rows=state.assessments.filter(a=>a.name.toLowerCase()===name.toLowerCase()); const max=rows.reduce((a,r)=>a+r.max,0); if(!max) return null; return rows.reduce((a,r)=>a+r.score,0)/max*100; }
  function classAvg(rows){ const vals=rows.map(r=>r.totalPercent).filter(v=>v!==null); return vals.length? vals.reduce((a,b)=>a+b,0)/vals.length : null; }
  function analysisRows(test){ if(!test) return []; return getFilteredRows(test).map(r=>{ const stu=getStudent(r.name)||{}; const totalPercent = test.maxTotal ? (r.total/test.maxTotal*100) : null; const yearAvg=studentYearAvg(r.name); const weakTopic=studentWeakTopic(test,r); return {...r, gender:stu.gender||'Unspecified', section:stu.section||test.className||'', totalPercent, yearAvg, weakTopic, ntToTeacher:gradeDiff(r.ntGrade,r.teacherGrade), ntToFinal:gradeDiff(r.ntGrade,r.finalGrade)}; }); }
  function studentWeakTopic(test,r){ const map={}; r.scores.forEach((s,i)=>{ const topic=test.questions[i]?.topic||'General'; if(s.score===null) return; if(!map[topic]) map[topic]={score:0,max:0}; map[topic].score+=s.score; map[topic].max+=s.max; }); let weak=''; let pct=Infinity; Object.entries(map).forEach(([t,d])=>{ const p=d.max?d.score/d.max*100:Infinity; if(p<pct){pct=p; weak=t;} }); return weak?`${weak} (${pct.toFixed(0)}%)`:''; }
  function questionStats(test, rows){ return test.questions.map((q,i)=>{ const vals=rows.map(r=>r.scores[i]?.score).filter(v=>v!==null); const zeroCount=rows.filter(r=>r.scores[i]?.score===0).length; const avg=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null; return {label:q.label, topic:q.topic||'General', questionType:q.questionType||'Unspecified', skill:q.skill||'', knowledgeArea:q.knowledgeArea||'', level:q.level||'', notes:q.notes||'', max:q.max, avg, percent:avg===null?null:avg/q.max*100, attempts:vals.length, zeroCount}; }); }
  function topicStats(test, rows){ const map={}; rows.forEach(r=>r.scores.forEach((s,i)=>{ if(s.score===null) return; const topic=test.questions[i]?.topic || 'General'; if(!map[topic]) map[topic]={score:0,max:0}; map[topic].score+=s.score; map[topic].max+=s.max; })); return Object.entries(map).map(([topic,d])=>({topic, percent:d.max?d.score/d.max*100:null, score:d.score, max:d.max})); }

  function typeStats(test, rows){ const map={}; rows.forEach(r=>r.scores.forEach((s,i)=>{ if(s.score===null) return; const type=test.questions[i]?.questionType || 'Unspecified'; if(!map[type]) map[type]={score:0,max:0}; map[type].score+=s.score; map[type].max+=s.max; })); return Object.entries(map).map(([questionType,d])=>({questionType, percent:d.max?d.score/d.max*100:null, score:d.score, max:d.max})); }
  function deviationSizeStats(rows){ const data={Same:0,'1 step up':0,'2+ steps up':0,'1 step down':0,'2+ steps down':0,'Missing grade':0}; rows.forEach(r=>{ const d=r.ntToFinal; if(d===null) data['Missing grade']++; else if(d===0) data.Same++; else if(d===1) data['1 step up']++; else if(d>=2) data['2+ steps up']++; else if(d===-1) data['1 step down']++; else if(d<=-2) data['2+ steps down']++; }); return data; }
  function movementSummary(rows){ const vals=rows.map(r=>r.ntToFinal).filter(d=>d!==null); const avg=vals.length? vals.reduce((a,b)=>a+Math.abs(b),0)/vals.length : 0; const maxUp=vals.length?Math.max(...vals):0; const maxDown=vals.length?Math.min(...vals):0; return {same:rows.filter(r=>r.ntToFinal===0).length, up:rows.filter(r=>r.ntToFinal>0).length, down:rows.filter(r=>r.ntToFinal<0).length, big:rows.filter(r=>Math.abs(r.ntToFinal||0)>=2).length, missing:rows.filter(r=>r.ntToFinal===null).length, avgDeviation:avg, maxUp, maxDown}; }
  function groupDeviation(rows,key){ const map={}; rows.forEach(r=>{ const k=r[key]||'Unspecified'; if(!map[k]) map[k]={n:0,same:0,up:0,down:0,big:0,avg:[]}; const m=map[k]; m.n++; if(r.ntToFinal===0)m.same++; else if(r.ntToFinal>0)m.up++; else if(r.ntToFinal<0)m.down++; if(Math.abs(r.ntToFinal||0)>=2)m.big++; if(r.ntToFinal!==null)m.avg.push(Math.abs(r.ntToFinal)); }); return Object.entries(map).map(([group,d])=>({group,...d, avgDev:d.avg.length?d.avg.reduce((a,b)=>a+b,0)/d.avg.length:0})); }
  function riskCategory(r){ if(r.ntGrade==='F' && r.finalGrade==='F') return 'Failed NT and final'; if(r.ntGrade==='F' && r.finalGrade && r.finalGrade!=='F') return 'Failed NT but passed final'; if(r.ntGrade && r.ntGrade!=='F' && r.finalGrade==='F') return 'Passed NT but failed final'; if((r.totalPercent??100)<40 || r.finalGrade==='F') return 'High risk'; if((r.totalPercent??100)<55 || r.ntGrade==='E') return 'Borderline support'; return 'No immediate risk'; }


  function render(){ renderStudents(); renderSelectors(); renderTopics(); renderDashboard(); renderStudentTable(); }
  function renderStudents(){ const div=$('#studentsTable'); if(!state.students.length){div.innerHTML='<p class="hint">No students yet.</p>'; return;} div.innerHTML='<table><thead><tr><th>Name</th><th>Gender</th><th>Class/Section</th><th></th></tr></thead><tbody>'+state.students.map(s=>`<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.gender||'')}</td><td>${escapeHtml(s.section||'')}</td><td><button class="danger" data-del-student="${s.id}">Delete</button></td></tr>`).join('')+'</tbody></table>'; }
  function renderSelectors(){
    const sel=$('#testSelector');
    if(state.ntTests.length){
      const allSelected = activeTestId === 'all';
      sel.innerHTML = `<option value="all" ${allSelected?'selected':''}>All National Tests / All Classes</option>` + state.ntTests.map(t=>`<option value="${t.id}" ${t.id===activeTestId?'selected':''}>${escapeHtml(t.title)}</option>`).join('');
    } else {
      sel.innerHTML = '<option value="">No test imported</option>';
    }
    const sections=[...new Set(state.students.map(s=>s.section).filter(Boolean).concat(state.ntTests.map(t=>t.className).filter(Boolean)))];
    $('#sectionFilter').innerHTML='<option value="all">All</option>'+sections.map(s=>`<option>${escapeHtml(s)}</option>`).join('');
    const genders=[...new Set(state.students.map(s=>s.gender||'Unspecified'))];
    $('#genderFilter').innerHTML='<option value="all">All</option>'+genders.map(g=>`<option>${escapeHtml(g)}</option>`).join('');
  }
  function renderTopics(){
    const test=selectedTest(); const div=$('#topicEditor');
    if(!test){div.innerHTML='<p class="hint">Import a National Test first.</p>'; return;}
    const editable = !test.isAggregate;
    const note = test.isAggregate ? '<p class="hint">You are viewing all classes together. To edit topics, choose one specific National Test, or upload the question mapping file.</p>' : '';
    div.innerHTML = note + '<table><thead><tr><th>Part</th><th>Question</th><th>Max</th><th>Topic</th><th>Question Type</th><th>Skill / Ability</th><th>Knowledge Area</th><th>Level</th><th>Notes</th></tr></thead><tbody>'+test.questions.map((q,i)=>`<tr><td>${escapeHtml(q.part||'')}</td><td>${escapeHtml(q.label)}</td><td>${q.max}</td><td>${editable?`<input class="topic-input" data-topic-index="${i}" value="${escapeHtml(q.topic||'General')}">`:escapeHtml(q.topic||'General')}</td><td>${escapeHtml(q.questionType||'')}</td><td>${escapeHtml(q.skill||'')}</td><td>${escapeHtml(q.knowledgeArea||'')}</td><td>${escapeHtml(q.level||'')}</td><td>${escapeHtml(q.notes||'')}</td></tr>`).join('')+'</tbody></table>';
  }
  function renderDashboard(){
    const test=selectedTest();
    const rows=analysisRows(test);
    if(!test){
      $('#kpiGrid').innerHTML='<div class="kpi"><div class="label">Status</div><div class="value">No NT</div></div>';
      ['gradeChart','questionChart','topicChart','deviationChart','questionTypeChart','deviationSizeChart','movementSummary','failingRiskReport','genderDeviationReport','sectionDeviationReport','deviationDocumentationReport','teacherPlanningReport'].forEach(id=>{ const el=$('#'+id); if(el) el.innerHTML=''; });
      return;
    }
    const avg=classAvg(rows);
    const failNt=rows.filter(r=>r.ntGrade==='F').length;
    const failFinal=rows.filter(r=>r.finalGrade==='F').length;
    const diffUp=rows.filter(r=>r.ntToFinal>0).length;
    const diffDown=rows.filter(r=>r.ntToFinal<0).length;
    const bigDev=rows.filter(r=>Math.abs(r.ntToFinal||0)>=2).length;
    $('#kpiGrid').innerHTML=[['Students',rows.length],['NT average',avg===null?'-':avg.toFixed(1)+'%'],['Failing NT',failNt],['Failing final',failFinal],['Final up/down',`${diffUp}/${diffDown}`],['Big deviations',bigDev]].map(k=>`<div class="kpi"><div class="label">${k[0]}</div><div class="value">${k[1]}</div></div>`).join('');
    renderBarChart('gradeChart', gradeDistribution(rows), 'grade');
    renderBarChart('questionChart', questionStats(test,rows).filter(q=>q.percent!==null).sort((a,b)=>a.percent-b.percent).slice(0,8).map(q=>({label:'Q'+q.label, value:q.percent, color:q.percent<50?'bad':'warn'})), 'percent');
    renderBarChart('topicChart', topicStats(test,rows).filter(t=>t.percent!==null).sort((a,b)=>a.percent-b.percent).map(t=>({label:t.topic, value:t.percent, color:t.percent<50?'bad':t.percent<70?'warn':'good'})), 'percent');
    renderBarChart('deviationChart', [{label:'Same',value:rows.filter(r=>r.ntToFinal===0).length,color:'good'},{label:'Final higher',value:diffUp,color:'warn'},{label:'Final lower',value:diffDown,color:'bad'}], 'count');
    renderBarChart('questionTypeChart', typeStats(test,rows).filter(t=>t.percent!==null).sort((a,b)=>a.percent-b.percent).map(t=>({label:t.questionType, value:t.percent, color:t.percent<50?'bad':t.percent<70?'warn':'good'})), 'percent');
    const devStats=deviationSizeStats(rows); renderBarChart('deviationSizeChart', Object.entries(devStats).map(([label,value])=>({label,value,color:label.includes('down')?'bad':label.includes('up')?'warn':'good'})), 'count');
    renderExtraReports(test,rows);
  }

  function miniTable(headers, rows){
    return '<table class="mini-table"><thead><tr>'+headers.map(h=>`<th>${escapeHtml(h)}</th>`).join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>`<td>${typeof c==='string' && c.includes('<span')?c:escapeHtml(c)}</td>`).join('')+'</tr>').join('')+'</tbody></table>';
  }
  function renderExtraReports(test, rows){
    const m=movementSummary(rows);
    $('#movementSummary').innerHTML=miniTable(['Measure','Value'],[
      ['Same grade',m.same],['Final grade higher',m.up],['Final grade lower',m.down],['Big deviations (2+ steps)',m.big],['Missing grade comparison',m.missing],['Average absolute deviation',m.avgDeviation.toFixed(2)],['Biggest increase',m.maxUp],['Biggest decrease',m.maxDown]
    ]);
    const riskGroups={}; rows.forEach(r=>{ const c=riskCategory(r); riskGroups[c]=(riskGroups[c]||0)+1; });
    $('#failingRiskReport').innerHTML=miniTable(['Risk group','Students'],Object.entries(riskGroups).map(([k,v])=>[k,v]));
    $('#genderDeviationReport').innerHTML=miniTable(['Gender','Students','Same','Up','Down','Big','Avg dev'],groupDeviation(rows,'gender').map(g=>[g.group,g.n,g.same,g.up,g.down,g.big,g.avgDev.toFixed(2)]));
    $('#sectionDeviationReport').innerHTML=miniTable(['Section','Students','Same','Up','Down','Big','Avg dev'],groupDeviation(rows,'section').map(g=>[g.group,g.n,g.same,g.up,g.down,g.big,g.avgDev.toFixed(2)]));
    const needsDoc=rows.filter(r=>r.ntToFinal!==0 || !r.motivation);
    $('#deviationDocumentationReport').innerHTML=needsDoc.length ? miniTable(['Name','NT','Final','Deviation','Documentation status','Reason / motivation'],needsDoc.map(r=>[r.name,r.ntGrade||'-',r.finalGrade||'-',diffText(r.ntToFinal),r.motivation||r.reason?'Has note':'Needs explanation',r.motivation||r.reason||''])) : '<p class="hint">No deviations needing documentation.</p>';
    const weakQ=questionStats(test,rows).filter(q=>q.percent!==null).sort((a,b)=>a.percent-b.percent).slice(0,5);
    const weakT=topicStats(test,rows).filter(q=>q.percent!==null).sort((a,b)=>a.percent-b.percent).slice(0,5);
    const weakTypes=typeStats(test,rows).filter(q=>q.percent!==null).sort((a,b)=>a.percent-b.percent).slice(0,5);
    $('#teacherPlanningReport').innerHTML='<div class="planning-block"><strong>Priority questions:</strong> '+(weakQ.map(q=>`Q${escapeHtml(q.label)} (${q.percent.toFixed(1)}%)`).join(', ')||'No data')+'</div>'+
      '<div class="planning-block"><strong>Priority topics:</strong> '+(weakT.map(t=>`${escapeHtml(t.topic)} (${t.percent.toFixed(1)}%)`).join(', ')||'No data')+'</div>'+
      '<div class="planning-block"><strong>Priority question types:</strong> '+(weakTypes.map(t=>`${escapeHtml(t.questionType)} (${t.percent.toFixed(1)}%)`).join(', ')||'No data')+'</div>'+
      '<div class="planning-block"><strong>Suggested teaching action:</strong> Plan small revision groups using the weakest questions first, then practise the weakest question types with model answers and sentence starters.</div>';
  }

  function gradeDistribution(rows){ return GRADE_ORDER.map(g=>({label:g, value:rows.filter(r=>r.ntGrade===g).length, color:g==='F'?'bad':'good'})); }
  function renderBarChart(id, data, mode){ const max=Math.max(1,...data.map(d=>d.value||0)); $('#'+id).innerHTML = data.length?data.map(d=>`<div class="bar-row"><div>${escapeHtml(d.label)}</div><div class="bar-track"><div class="bar-fill ${d.color||''}" style="width:${Math.max(2,(d.value/max*100))}%"></div></div><div>${mode==='percent'?d.value.toFixed(0)+'%':d.value}</div></div>`).join(''):'<p class="hint">No data.</p>'; }
  function renderStudentTable(){ const test=selectedTest(); const rows=analysisRows(test); if(!test){ $('#studentAnalysisTable').innerHTML='<p class="hint">Import a National Test first.</p>'; return;} $('#studentAnalysisTable').innerHTML='<table><thead><tr><th>Name</th><th>Gender</th><th>Section</th><th>NT total</th><th>NT %</th><th>NT grade</th><th>Teacher grade</th><th>Final grade</th><th>NT → Final</th><th>Year avg</th><th>Weakest topic</th><th>Support suggestion</th><th>Motivation</th></tr></thead><tbody>'+rows.map(r=>`<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.gender)}</td><td>${escapeHtml(r.section)}</td><td>${r.total}/${test.maxTotal}</td><td>${r.totalPercent?.toFixed(1)||'-'}%</td><td>${badge(r.ntGrade)}</td><td>${badge(r.teacherGrade)}</td><td>${badge(r.finalGrade)}</td><td>${badge(diffText(r.ntToFinal), r.ntToFinal===0?'good':r.ntToFinal>0?'warn':'bad')}</td><td>${r.yearAvg===null?'-':r.yearAvg.toFixed(1)+'%'}</td><td>${escapeHtml(r.weakTopic)}</td><td>${escapeHtml(supportText(r))}</td><td>${escapeHtml(r.motivation || r.reason || '')}</td></tr>`).join('')+'</tbody></table>'; }
  function badge(text,type){ type=type || (text==='F'?'bad':text==='-'?'neutral':'good'); return `<span class="badge ${type}">${escapeHtml(text||'-')}</span>`; }
  function supportText(r){ const p=r.totalPercent??0; if(r.ntGrade==='F'&&r.finalGrade==='F') return 'High priority: needs support plan and focused practice.'; if(r.ntGrade==='F'&&r.finalGrade!=='F') return 'Check evidence from class work; support NT exam skills.'; if(p<50) return 'Needs practice on basic knowledge and vocabulary.'; if(r.ntToFinal<0) return 'Final grade is lower than NT; review missing yearly evidence.'; if(r.weakTopic) return 'Target practice: '+r.weakTopic; return 'Continue regular practice and feedback.'; }

  function generateConclusion(){ const test=selectedTest(); const rows=analysisRows(test); if(!test||!rows.length){ $('#conclusionBox').textContent='Import a National Test first.'; return;} const avg=classAvg(rows); const q=questionStats(test,rows).filter(x=>x.percent!==null).sort((a,b)=>a.percent-b.percent)[0]; const t=topicStats(test,rows).filter(x=>x.percent!==null).sort((a,b)=>a.percent-b.percent)[0]; const failNt=rows.filter(r=>r.ntGrade==='F'), failFinal=rows.filter(r=>r.finalGrade==='F'); const up=rows.filter(r=>r.ntToFinal>0), down=rows.filter(r=>r.ntToFinal<0); const byGender=groupAvg(rows,'gender'), bySection=groupAvg(rows,'section'); let txt=`Summary for ${test.title}\n\nClass average in the National Test: ${avg?.toFixed(1)}%.\nStudents failing the National Test: ${failNt.length}. Students failing final grade: ${failFinal.length}.\nFinal grade higher than NT grade: ${up.length}. Final grade lower than NT grade: ${down.length}.\n`; const qt=typeStats(test,rows).filter(x=>x.percent!==null).sort((a,b)=>a.percent-b.percent)[0]; const docNeed=rows.filter(r=>r.ntToFinal!==0 && !(r.motivation||r.reason)).length; if(q) txt+=`\nWeakest question: Question ${q.label} (${q.percent.toFixed(1)}% average).`; if(t) txt+=`\nWeakest topic: ${t.topic} (${t.percent.toFixed(1)}% average).`; if(qt) txt+=`\nWeakest question type: ${qt.questionType} (${qt.percent.toFixed(1)}% average).`; txt+=`\nDeviation documentation needed: ${docNeed} student(s).`; txt+=`\n\nGender trend: ${byGender}.\nSection trend: ${bySection}.\n\nSuggested action:\n1. Give focused practice on the weakest topic and weakest questions.\n2. Practise the weakest question type with examples and model answers.\n3. Check students with F in NT and F in final grade first.\n4. For students where final grade is different from NT grade, write a short evidence note explaining the difference.\n5. Use the question report and deviation report to plan revision groups and moderation discussions.`; $('#conclusionBox').textContent=txt; }
  function groupAvg(rows,key){ const m={}; rows.forEach(r=>{ const k=r[key]||'Unspecified'; if(!m[k]) m[k]=[]; if(r.totalPercent!==null) m[k].push(r.totalPercent); }); return Object.entries(m).map(([k,v])=>`${k}: ${(v.reduce((a,b)=>a+b,0)/v.length).toFixed(1)}%`).join(', ') || 'No data'; }

  function studentReportCsv(){ const test=selectedTest(); return ['Name,Gender,Section,NT Total,Max,NT %,NT Grade,Teacher Grade,Final Grade,NT to Final,Year Avg,Weakest Topic,Support Suggestion,Motivation'].concat(analysisRows(test).map(r=>[r.name,r.gender,r.section,r.total,test.maxTotal,r.totalPercent?.toFixed(1),r.ntGrade,r.teacherGrade,r.finalGrade,diffText(r.ntToFinal),r.yearAvg===null?'':r.yearAvg.toFixed(1),r.weakTopic,supportText(r),r.motivation||r.reason||''].map(csvEscape).join(','))).join('\n'); }
  function questionReportCsv(){ const test=selectedTest(); return ['Question,Topic,Question Type,Skill / Ability,Knowledge Area,E/C/A Level,Max,Average,Percent,Attempts,Zero Count,Notes'].concat(questionStats(test,analysisRows(test)).map(q=>[q.label,q.topic,q.questionType,q.skill,q.knowledgeArea,q.level,q.max,q.avg?.toFixed(2)||'',q.percent?.toFixed(1)||'',q.attempts,q.zeroCount,q.notes].map(csvEscape).join(','))).join('\n'); }
  function deviationReportCsv(){ const test=selectedTest(); return ['Name,Gender,Section,NT Grade,Teacher Grade,Final Grade,NT to Teacher,NT to Final,Documentation Status,Reason,Motivation,Risk Category'].concat(analysisRows(test).map(r=>[r.name,r.gender,r.section,r.ntGrade,r.teacherGrade,r.finalGrade,diffText(r.ntToTeacher),diffText(r.ntToFinal),(r.ntToFinal!==0 && !(r.motivation||r.reason))?'Needs explanation':'Has/Not needed',r.reason||'',r.motivation||'',riskCategory(r)].map(csvEscape).join(','))).join('\n'); }

  function attach(){
    $('#addStudentBtn').addEventListener('click',()=>{ upsertStudent($('#studentName').value,$('#studentGender').value,$('#studentSection').value); $('#studentName').value=''; $('#studentGender').value=''; $('#studentSection').value=''; saveState(); render(); });
    $('#importStudentsBtn').addEventListener('click',importStudents); $('#importNtBtn').addEventListener('click',importNationalTest); $('#importYearBtn').addEventListener('click',importYear); $('#addAssessmentBtn').addEventListener('click',addAssessment); $('#importQuestionMapBtn').addEventListener('click',importQuestionMap);
    $('#downloadStudentTemplateBtn')?.addEventListener('click',()=>downloadFile('student-list-template.csv', studentTemplateCsv(), 'text/csv'));
    $('#downloadNtTemplateBtn')?.addEventListener('click',()=>downloadFile('national-test-template.csv', ntTemplateCsv(), 'text/csv'));
    $('#downloadYearTemplateBtn')?.addEventListener('click',()=>downloadFile('year-assessment-template.csv', yearAssessmentTemplateCsv(), 'text/csv'));
    $('#downloadMappingTemplateBtn')?.addEventListener('click',()=>downloadFile('question-topic-type-mapping-template.csv', mappingTemplateCsv(), 'text/csv'));
    $('#downloadKemiMappingBtn')?.addEventListener('click',()=>downloadFile('kemi-2026-question-topic-type-mapping.csv', defaultKemiMappingCsv(), 'text/csv'));
    $('#testSelector').addEventListener('change',e=>{activeTestId=e.target.value; state.settings.activeTestId=activeTestId; saveState(); render();}); $('#sectionFilter').addEventListener('change',renderDashboard); $('#genderFilter').addEventListener('change',renderDashboard);
    document.body.addEventListener('click',e=>{ const sid=e.target.dataset.delStudent; if(sid && confirm('Delete this student?')){ state.students=state.students.filter(s=>s.id!==sid); saveState(); render(); }});
    document.body.addEventListener('change',e=>{ if(e.target.dataset.topicIndex){ const test=selectedTest(); if(test){ test.questions[+e.target.dataset.topicIndex].topic=norm(e.target.value)||'General'; test.students.forEach(r=>{ if(r.scores[+e.target.dataset.topicIndex]) r.scores[+e.target.dataset.topicIndex].topic=test.questions[+e.target.dataset.topicIndex].topic; }); saveState(); renderDashboard(); renderStudentTable(); }} });
    $('#generateConclusionBtn').addEventListener('click',generateConclusion); $('#downloadStudentReportBtn').addEventListener('click',()=>downloadFile('student-analysis-report.csv', studentReportCsv(), 'text/csv')); $('#downloadQuestionReportBtn').addEventListener('click',()=>downloadFile('question-analysis-report.csv', questionReportCsv(), 'text/csv')); $('#downloadDeviationReportBtn').addEventListener('click',()=>downloadFile('deviation-documentation-report.csv', deviationReportCsv(), 'text/csv'));
    $('#exportBackupBtn').addEventListener('click',()=>downloadFile('teacher-grade-analysis-backup.json', JSON.stringify(state,null,2), 'application/json'));
    $('#importBackupInput').addEventListener('change',async e=>{ const f=e.target.files[0]; if(!f) return; const data=JSON.parse(await f.text()); Object.assign(state, data); activeTestId=state.settings?.activeTestId || state.ntTests?.[0]?.id || null; saveState(); render(); });
    $('#clearAllBtn').addEventListener('click',()=>{ if(confirm('Delete all saved app data in this browser?')){ localStorage.removeItem(STORAGE_KEY); location.reload(); }});
  }
  attach(); render();
})();
