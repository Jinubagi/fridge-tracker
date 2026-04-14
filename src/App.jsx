import { useState, useRef, useEffect, useMemo } from "react";
import { auth, provider, db } from "./firebase";
import { signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged } from "firebase/auth";
import { ref, onValue, set, get, remove } from "firebase/database";

const DEFAULT_CATEGORIES = [
  { name: "채소", color: "#1D9E75" },
  { name: "과일", color: "#D85A30" },
  { name: "육류", color: "#A32D2D" },
  { name: "해산물/수산", color: "#0F6E56" },
  { name: "유제품", color: "#BA7517" },
  { name: "계란", color: "#EF9F27" },
  { name: "두부/콩류", color: "#639922" },
  { name: "면/파스타", color: "#7F77DD" },
  { name: "밥/곡류", color: "#D4537E" },
  { name: "냉동식품", color: "#378ADD" },
  { name: "양념/소스", color: "#993556" },
  { name: "음료/주스", color: "#185FA5" },
  { name: "술", color: "#72243E" },
  { name: "간식/과자", color: "#534AB7" },
  { name: "기타", color: "#5F5E5A" },
];

const COLORS = ["#1D9E75","#D85A30","#A32D2D","#0F6E56","#BA7517","#EF9F27","#639922","#7F77DD","#D4537E","#378ADD","#993556","#185FA5","#72243E","#534AB7","#5F5E5A","#0C447C","#854F0B","#3B6D11"];

const genId = () => `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
const genCode = () => Math.random().toString(36).substr(2, 6).toUpperCase();
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

async function callClaude(prompt, imageBase64 = null) {
  const content = imageBase64
    ? [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } }, { type: "text", text: prompt }]
    : [{ type: "text", text: prompt }];
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content }] })
  });
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("fridge");
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState([]);
  const [aiInput, setAiInput] = useState("");
  const [aiResult, setAiResult] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [useQty, setUseQty] = useState({});
  const [filterCat, setFilterCat] = useState("전체");
  const [newCatName, setNewCatName] = useState("");
  const [newCatColor, setNewCatColor] = useState(COLORS[0]);
  const [editingCat, setEditingCat] = useState(null);
  const [form, setForm] = useState({ name: "", qty: "", unit: "개", category: DEFAULT_CATEGORIES[0].name });
  const [recipeModal, setRecipeModal] = useState(null);
  const [familyCode, setFamilyCode] = useState(null);
  const [familyMembers, setFamilyMembers] = useState([]);
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [familyMsg, setFamilyMsg] = useState("");
  const [showFamilyPanel, setShowFamilyPanel] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const galleryRef = useRef();

  const dataPath = useMemo(() => {
    if (!user) return null;
    return familyCode ? `families/${familyCode}` : `users/${user.uid}`;
  }, [user, familyCode]);

  const getCatColor = (name) => categories.find(c => c.name === name)?.color || "#888";
  const catNames = categories.map(c => c.name);

  useEffect(() => {
    getRedirectResult(auth).catch(() => {});
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const snap = await get(ref(db, `users/${u.uid}/familyCode`));
        if (snap.val()) setFamilyCode(snap.val());
      }
      setAuthLoading(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!user || !dataPath) return;
    setLoaded(false);
    const unsub1 = onValue(ref(db, `${dataPath}/items`), (snap) => {
      setItems(snap.val() ? Object.values(snap.val()) : []);
      setLoaded(true);
    });
    const unsub2 = onValue(ref(db, `${dataPath}/categories`), (snap) => {
      setCategories(snap.val() ? Object.values(snap.val()) : DEFAULT_CATEGORIES);
    });
    let unsub3 = () => {};
    if (familyCode) {
      unsub3 = onValue(ref(db, `families/${familyCode}/members`), (snap) => {
        setFamilyMembers(snap.val() ? Object.values(snap.val()) : []);
      });
    }
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [user, dataPath, familyCode]);

  useEffect(() => {
    if (!user || !dataPath || !loaded) return;
    const obj = {};
    items.forEach(i => { obj[String(i.id).replace(/\./g, "_")] = i; });
    set(ref(db, `${dataPath}/items`), items.length === 0 ? null : obj);
  }, [items]);

  useEffect(() => {
    if (!user || !dataPath || !loaded) return;
    const obj = {};
    categories.forEach((c, i) => { obj[i] = c; });
    set(ref(db, `${dataPath}/categories`), obj);
  }, [categories]);

  const login = () => {
    if (isMobile) {
      signInWithRedirect(auth, provider);
    } else {
      signInWithPopup(auth, provider);
    }
  };

  const logout = () => {
    signOut(auth);
    setItems([]);
    setCategories(DEFAULT_CATEGORIES);
    setFamilyCode(null);
    setFamilyMembers([]);
    setLoaded(false);
  };

  const createFamily = async () => {
    const code = genCode();
    await set(ref(db, `families/${code}/members/${user.uid}`), {
      uid: user.uid, name: user.displayName, photo: user.photoURL,
    });
    const itemsSnap = await get(ref(db, `users/${user.uid}/items`));
    const catsSnap = await get(ref(db, `users/${user.uid}/categories`));
    if (itemsSnap.val()) await set(ref(db, `families/${code}/items`), itemsSnap.val());
    if (catsSnap.val()) await set(ref(db, `families/${code}/categories`), catsSnap.val());
    await set(ref(db, `users/${user.uid}/familyCode`), code);
    setFamilyCode(code);
    setFamilyMsg(`✅ 가족 코드 생성 완료!`);
  };

  const joinFamily = async () => {
    const code = joinCodeInput.trim().toUpperCase();
    if (!code) return;
    const snap = await get(ref(db, `families/${code}`));
    if (!snap.val()) { setFamilyMsg("❌ 존재하지 않는 코드예요."); return; }
    await set(ref(db, `families/${code}/members/${user.uid}`), {
      uid: user.uid, name: user.displayName, photo: user.photoURL,
    });
    await set(ref(db, `users/${user.uid}/familyCode`), code);
    setFamilyCode(code);
    setJoinCodeInput("");
    setFamilyMsg("✅ 가족 냉장고에 참여했어요!");
  };

  const leaveFamily = async () => {
    if (!familyCode) return;
    await remove(ref(db, `families/${familyCode}/members/${user.uid}`));
    await remove(ref(db, `users/${user.uid}/familyCode`));
    setFamilyCode(null);
    setFamilyMembers([]);
    setLoaded(false);
    setFamilyMsg("가족 냉장고에서 나왔어요.");
  };

  const addCategory = () => {
    if (!newCatName.trim() || categories.find(c => c.name === newCatName.trim())) return;
    setCategories(prev => [...prev, { name: newCatName.trim(), color: newCatColor }]);
    setNewCatName("");
  };

  const removeCategory = (name) => {
    setCategories(prev => prev.filter(c => c.name !== name));
    setItems(prev => prev.map(i => i.category === name ? { ...i, category: "기타" } : i));
    if (filterCat === name) setFilterCat("전체");
  };

  const updateCategoryColor = (name, color) => {
    setCategories(prev => prev.map(c => c.name === name ? { ...c, color } : c));
  };

  const updateCategoryName = (oldName, newName) => {
    if (!newName.trim() || categories.find(c => c.name === newName.trim() && c.name !== oldName)) return;
    setCategories(prev => prev.map(c => c.name === oldName ? { ...c, name: newName.trim() } : c));
    setItems(prev => prev.map(i => i.category === oldName ? { ...i, category: newName.trim() } : i));
    setEditingCat(null);
  };

  const handlePhoto = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    setScanning(true);
    setScanned([]);
    setTab("scan");
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = ev.target.result.split(",")[1];
      try {
        const catList = catNames.join("|");
        const text = await callClaude(
          `이 이미지를 분석해서 식료품 목록을 추출해주세요.
영수증, 냉장고 내부 사진, 제품 사진 모두 가능해요. 보이는 식료품을 모두 파악해주세요.
수량을 알 수 없으면 1로, 단위는 개/g/ml/팩/봉/병 중 적절한 걸 선택하세요.
반드시 아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
{"items":[{"name":"상품명","qty":1,"unit":"개","category":"분류"}]}
카테고리는 반드시 이 목록 중 하나로만 분류하세요: ${catList}`, base64);
        const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
        setScanned(parsed.items.map(i => ({ ...i, id: genId() })));
      } catch { setScanned([]); }
      setScanning(false);
    };
    reader.readAsDataURL(file);
  };

  const updateScanned = (id, field, val) => setScanned(prev => prev.map(i => i.id === id ? { ...i, [field]: val } : i));

  const confirmScanned = () => {
    if (scanned.length === 0) return;
    setItems(prev => [...prev, ...scanned.map(i => ({ ...i, id: genId() }))]);
    setScanned([]);
    setTab("fridge");
  };

  const removeItem = (id) => setItems(prev => prev.filter(i => i.id !== id));

  const applyUse = (item) => {
    const used = parseFloat(useQty[item.id] || 0);
    if (!used) return;
    const newQty = Math.max(0, item.qty - used);
    setItems(prev => newQty === 0 ? prev.filter(i => i.id !== item.id) : prev.map(i => i.id === item.id ? { ...i, qty: newQty } : i));
    setUseQty(prev => ({ ...prev, [item.id]: "" }));
  };

  const addItem = () => {
    if (!form.name.trim()) return;
    setItems(prev => [...prev, { ...form, qty: parseFloat(form.qty) || 1, id: genId() }]);
    setForm(p => ({ ...p, name: "", qty: "" }));
  };

  const callAI = async () => {
    if (!aiInput.trim() || items.length === 0) return;
    setAiLoading(true);
    setAiResult([]);
    const list = items.map(i => `${i.name}(${i.qty}${i.unit})`).join(", ");
    try {
      const text = await callClaude(`당신은 요리 전문가입니다.
현재 냉장고 재료: ${list}
사용자 요청: ${aiInput}
반드시 아래 JSON 형식으로만 응답하세요:
{"recipes":[{"name":"요리명","ingredients":["재료명 수량(예: 계란 2개)"],"tip":"팁","difficulty":"쉬움/보통/어려움"}]}`);
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
      setAiResult(parsed.recipes);
    } catch { setAiResult("error"); }
    setAiLoading(false);
  };

  const openRecipeModal = (recipe) => {
    const usages = recipe.ingredients.map(ingStr => {
      const matched = items.find(item => ingStr.includes(item.name));
      if (!matched) return { item: null, ingStr, used: 1 };
      const numMatch = ingStr.match(/(\d+(\.\d+)?)/);
      const used = numMatch ? parseFloat(numMatch[1]) : 1;
      return { item: matched, ingStr, used };
    });
    setRecipeModal({ recipe, usages });
  };

  const confirmRecipe = () => {
    let newItems = [...items];
    recipeModal.usages.forEach(({ item, used }) => {
      if (!item) return;
      const newQty = Math.max(0, item.qty - used);
      if (newQty === 0) newItems = newItems.filter(i => i.id !== item.id);
      else newItems = newItems.map(i => i.id === item.id ? { ...i, qty: newQty } : i);
    });
    setItems(newItems);
    setRecipeModal(null);
  };

  const filtered = filterCat === "전체" ? items : items.filter(i => i.category === filterCat);

  const s = {
    card: { background: "#fff", border: "1px solid #eee", borderRadius: 12, padding: "1rem", marginBottom: 10 },
    btn: (active, color) => ({ padding: "7px 14px", borderRadius: 8, border: `1px solid ${active ? (color||"#378ADD") : "#ddd"}`, background: active ? (color||"#378ADD") : "#fff", color: active ? "#fff" : "#444", cursor: "pointer", fontSize: 14 }),
    input: { padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, width: "100%", boxSizing: "border-box" },
  };

  return (
    <div style={{ maxWidth: 500, margin: "0 auto", padding: "1rem", fontFamily: "system-ui, sans-serif", color: "#222" }}>

      {recipeModal && (
        <div style={{ position: "fixed", inset: 0, background: "#0006", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: "1rem" }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: "1.5rem", width: "100%", maxWidth: 420 }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 17 }}>✅ {recipeModal.recipe.name}</h3>
            <p style={{ fontSize: 13, color: "#888", margin: "0 0 16px" }}>사용한 재료와 수량을 확인해주세요!</p>
            {recipeModal.usages.map((u, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                {u.item ? (
                  <>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: getCatColor(u.item.category), flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 14 }}>{u.item.name}</span>
                    <span style={{ fontSize: 12, color: "#aaa" }}>보유: {u.item.qty}{u.item.unit}</span>
                    <input type="number" value={u.used} min={0} max={u.item.qty}
                      onChange={e => setRecipeModal(prev => ({
                        ...prev,
                        usages: prev.usages.map((x, j) => j === i ? { ...x, used: parseFloat(e.target.value) || 0 } : x)
                      }))}
                      style={{ ...s.input, width: 60, fontSize: 13 }} />
                    <span style={{ fontSize: 12, color: "#aaa" }}>{u.item.unit}</span>
                  </>
                ) : (
                  <>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ddd", flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 14, color: "#aaa" }}>{u.ingStr} (냉장고에 없음)</span>
                  </>
                )}
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={confirmRecipe} style={{ ...s.btn(true), flex: 1 }}>확정 — 재료 차감</button>
              <button onClick={() => setRecipeModal(null)} style={s.btn(false)}>취소</button>
            </div>
          </div>
        </div>
      )}

      {showFamilyPanel && (
        <div style={{ position: "fixed", inset: 0, background: "#0006", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: "1rem" }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: "1.5rem", width: "100%", maxWidth: 420 }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 17 }}>👨‍👩‍👧 가족 냉장고 공유</h3>
            {!familyCode ? (
              <>
                <p style={{ fontSize: 13, color: "#888", marginBottom: 16 }}>가족 코드를 만들거나 기존 코드로 참여하세요!</p>
                <button onClick={createFamily} style={{ ...s.btn(true), width: "100%", marginBottom: 12 }}>➕ 가족 코드 만들기</button>
                <div style={{ display: "flex", gap: 8 }}>
                  <input style={{ ...s.input, flex: 1 }} placeholder="가족 코드 입력 (6자리)"
                    value={joinCodeInput} onChange={e => setJoinCodeInput(e.target.value.toUpperCase())} maxLength={6} />
                  <button onClick={joinFamily} style={s.btn(true)}>참여</button>
                </div>
              </>
            ) : (
              <>
                <div style={{ background: "#f0faf5", borderRadius: 10, padding: "12px 16px", marginBottom: 16, textAlign: "center" }}>
                  <p style={{ fontSize: 12, color: "#888", margin: "0 0 4px" }}>가족 코드</p>
                  <p style={{ fontSize: 28, fontWeight: 700, letterSpacing: 6, color: "#1D9E75", margin: 0 }}>{familyCode}</p>
                  <p style={{ fontSize: 12, color: "#aaa", margin: "4px 0 0" }}>이 코드를 가족에게 공유하세요!</p>
                </div>
                <p style={{ fontSize: 13, fontWeight: 500, margin: "0 0 8px" }}>멤버 ({familyMembers.length}명)</p>
                {familyMembers.map((m, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <img src={m.photo} width={28} height={28} style={{ borderRadius: "50%" }} alt="" />
                    <span style={{ fontSize: 14 }}>{m.name}</span>
                    {m.uid === user.uid && <span style={{ fontSize: 11, color: "#378ADD" }}>나</span>}
                  </div>
                ))}
                <button onClick={leaveFamily} style={{ ...s.btn(false), width: "100%", marginTop: 12, color: "#E24B4A", borderColor: "#fcc" }}>
                  가족 냉장고 나가기
                </button>
              </>
            )}
            {familyMsg && <p style={{ fontSize: 13, color: "#1D9E75", marginTop: 12 }}>{familyMsg}</p>}
            <button onClick={() => { setShowFamilyPanel(false); setFamilyMsg(""); }} style={{ ...s.btn(false), width: "100%", marginTop: 8 }}>닫기</button>
          </div>
        </div>
      )}

      {authLoading && (
        <div style={{ textAlign: "center", padding: "4rem 0", color: "#aaa" }}>
          <div style={{ fontSize: 40 }}>🧊</div>
          <p>로딩 중...</p>
        </div>
      )}

      {!authLoading && !user && (
        <div style={{ textAlign: "center", padding: "4rem 1rem" }}>
          <div style={{ fontSize: 50, marginBottom: 16 }}>🧊</div>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>냉장고 트래커</h2>
          <p style={{ color: "#888", marginBottom: 32 }}>Google 계정으로 로그인하면<br/>어느 기기에서든 냉장고를 관리할 수 있어요!</p>
          <button onClick={login} style={{ padding: "12px 32px", borderRadius: 12, border: "1px solid #ddd", background: "#fff", fontSize: 16, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 10, boxShadow: "0 2px 8px #0001" }}>
            <img src="https://www.google.com/favicon.ico" width={20} height={20} alt="google" />
            Google로 로그인
          </button>
        </div>
      )}

      {!authLoading && user && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem", flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>🧊 냉장고 트래커</h2>
              {familyCode && <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "#e8f4ff", color: "#378ADD" }}>👨‍👩‍👧 가족</span>}
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <img src={user.photoURL} width={28} height={28} style={{ borderRadius: "50%" }} alt="profile" />
              <button onClick={() => cameraRef.current.click()} style={{ ...s.btn(false), background: "#f0faf5", color: "#1D9E75", borderColor: "#1D9E75", fontSize: 12 }}>📷 스캔하기</button>
              <button onClick={() => galleryRef.current.click()} style={{ ...s.btn(false), background: "#f0faf5", color: "#1D9E75", borderColor: "#1D9E75", fontSize: 12 }}>🖼️ 사진 불러오기</button>
              <button onClick={() => setShowFamilyPanel(true)} style={{ ...s.btn(false), fontSize: 12, padding: "5px 10px" }}>👨‍👩‍👧 가족 냉장고</button>
              <button onClick={logout} style={{ ...s.btn(false), fontSize: 12, padding: "5px 10px" }}>로그아웃</button>
            </div>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={handlePhoto} />
            <input ref={galleryRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handlePhoto} />
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: "1rem", flexWrap: "wrap" }}>
            {[["fridge","🧊 냉장고"],["ai","✨ AI 추천"],["cats","📂 카테고리"],["guide","📖 사용설명서"]].map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} style={s.btn(tab===id)}>{label}</button>
            ))}
          </div>

          {tab === "scan" && (
            <div style={s.card}>
              {scanning ? (
                <div style={{ textAlign: "center", padding: "2rem", color: "#888" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
                  <p style={{ margin: 0 }}>이미지 분석 중...</p>
                </div>
              ) : scanned.length === 0 ? (
                <p style={{ color: "#aaa", textAlign: "center" }}>인식된 항목이 없어요.</p>
              ) : (
                <>
                  <p style={{ fontSize: 13, color: "#888", margin: "0 0 12px" }}>인식된 항목을 확인하고 수정해주세요!</p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 55px 45px 90px 24px", gap: 5, marginBottom: 6 }}>
                    {["이름","수량","단위","카테고리",""].map((h,i) => <span key={i} style={{ fontSize: 11, color: "#aaa" }}>{h}</span>)}
                  </div>
                  {scanned.map(item => (
                    <div key={item.id} style={{ display: "grid", gridTemplateColumns: "1fr 55px 45px 90px 24px", gap: 5, marginBottom: 6, alignItems: "center" }}>
                      <input value={item.name} onChange={e => updateScanned(item.id, "name", e.target.value)} style={{ ...s.input, fontSize: 13 }} />
                      <input type="number" value={item.qty} onChange={e => updateScanned(item.id, "qty", parseFloat(e.target.value))} style={{ ...s.input, fontSize: 13 }} />
                      <input value={item.unit} onChange={e => updateScanned(item.id, "unit", e.target.value)} style={{ ...s.input, fontSize: 13 }} />
                      <select value={item.category} onChange={e => updateScanned(item.id, "category", e.target.value)} style={{ ...s.input, fontSize: 12 }}>
                        {catNames.map(c => <option key={c}>{c}</option>)}
                      </select>
                      <button onClick={() => setScanned(prev => prev.filter(i => i.id !== item.id))} style={{ background: "none", border: "none", cursor: "pointer", color: "#E24B4A", fontSize: 18 }}>×</button>
                    </div>
                  ))}
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button onClick={confirmScanned} style={{ ...s.btn(true), flex: 1 }}>냉장고에 추가 ({scanned.length}개)</button>
                    <button onClick={() => { setScanned([]); setTab("fridge"); }} style={s.btn(false)}>취소</button>
                  </div>
                </>
              )}
            </div>
          )}

          {tab === "fridge" && (
            <>
              <div style={s.card}>
                <p style={{ fontSize: 12, color: "#888", margin: "0 0 8px" }}>직접 추가</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 60px 50px 1fr", gap: 6, marginBottom: 8 }}>
                  <input style={{ ...s.input, fontSize: 13 }} placeholder="재료명" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} onKeyDown={e => e.key === "Enter" && addItem()} />
                  <input type="number" style={{ ...s.input, fontSize: 13 }} placeholder="수량" value={form.qty} onChange={e => setForm(p => ({ ...p, qty: e.target.value }))} />
                  <input style={{ ...s.input, fontSize: 13 }} placeholder="단위" value={form.unit} onChange={e => setForm(p => ({ ...p, unit: e.target.value }))} />
                  <select style={{ ...s.input, fontSize: 12 }} value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
                    {catNames.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <button onClick={addItem} style={{ ...s.btn(true), width: "100%" }}>+ 추가</button>
              </div>

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                {["전체", ...catNames].map(c => (
                  <button key={c} onClick={() => setFilterCat(c)} style={{ fontSize: 12, padding: "4px 12px", borderRadius: 20, cursor: "pointer", background: filterCat === c ? (getCatColor(c) || "#378ADD") : "#f5f5f5", color: filterCat === c ? "#fff" : "#555", border: "none" }}>{c}</button>
                ))}
              </div>

              {filtered.length === 0 && (
                <div style={{ textAlign: "center", padding: "3rem 0", color: "#bbb" }}>
                  <div style={{ fontSize: 40, marginBottom: 8 }}>🧊</div>
                  <p style={{ margin: 0 }}>재료를 추가하거나 사진을 스캔해보세요!</p>
                </div>
              )}

              {filtered.map(item => (
                <div key={item.id} style={s.card}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: getCatColor(item.category), flexShrink: 0 }}></span>
                    <span style={{ fontWeight: 600, fontSize: 15, flex: 1 }}>{item.name}</span>
                    <span style={{ fontSize: 14, color: "#555" }}>{item.qty}{item.unit}</span>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: getCatColor(item.category) + "22", color: getCatColor(item.category), fontWeight: 500 }}>{item.category}</span>
                    <button onClick={() => removeItem(item.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#ccc", fontSize: 18 }}>×</button>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 18 }}>
                    <span style={{ fontSize: 12, color: "#aaa" }}>사용:</span>
                    <input type="number" placeholder="0" value={useQty[item.id] || ""} onChange={e => setUseQty(p => ({ ...p, [item.id]: e.target.value }))} style={{ ...s.input, width: 65, fontSize: 13 }} />
                    <span style={{ fontSize: 12, color: "#aaa" }}>{item.unit}</span>
                    <button onClick={() => applyUse(item)} style={{ ...s.btn(false), padding: "4px 14px", fontSize: 12 }}>적용</button>
                  </div>
                </div>
              ))}
            </>
          )}

          {tab === "ai" && (
            <div>
              <div style={s.card}>
                <p style={{ fontSize: 13, color: "#888", margin: "0 0 8px" }}>현재 재료: {items.length === 0 ? "없음" : items.map(i => i.name).join(", ")}</p>
                <textarea placeholder="예) 다이어트 식단으로 추천해줘 / 10분 안에 만들 수 있는 거 / 애들이 좋아할 만한 요리" value={aiInput} onChange={e => setAiInput(e.target.value)} style={{ ...s.input, height: 80, resize: "none", marginBottom: 10 }} />
                <button onClick={callAI} disabled={aiLoading || items.length === 0 || !aiInput.trim()} style={{ ...s.btn(true), width: "100%", opacity: (items.length===0||!aiInput.trim()) ? 0.4 : 1 }}>
                  {aiLoading ? "추천 중..." : "레시피 추천받기 ✨"}
                </button>
              </div>
              {aiResult === "error" && <p style={{ color: "#E24B4A", fontSize: 14 }}>오류가 생겼어요. 다시 시도해주세요.</p>}
              {Array.isArray(aiResult) && aiResult.map((r, i) => (
                <div key={i} style={s.card}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 15, flex: 1 }}>{r.name}</span>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "#e8f4ff", color: "#378ADD" }}>{r.difficulty}</span>
                  </div>
                  <p style={{ fontSize: 13, color: "#666", margin: "0 0 6px" }}>재료: {r.ingredients.join(", ")}</p>
                  <p style={{ fontSize: 13, color: "#333", margin: "0 0 12px" }}>💡 {r.tip}</p>
                  <div style={{ display: "flex", gap: 8 }}>
                    <a href={`https://www.youtube.com/results?search_query=${encodeURIComponent(r.name + " 레시피")}`} target="_blank" rel="noopener noreferrer"
                      style={{ ...s.btn(false), fontSize: 12, padding: "5px 12px", textDecoration: "none", color: "#E24B4A", borderColor: "#fcc", display: "inline-block" }}>
                      ▶ 유튜브 보기
                    </a>
                    <button onClick={() => openRecipeModal(r)} style={{ ...s.btn(false), fontSize: 12, padding: "5px 12px", color: "#1D9E75", borderColor: "#1D9E75" }}>
                      ✅ 해먹었어요
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "cats" && (
            <div>
              <div style={s.card}>
                <p style={{ fontSize: 13, fontWeight: 500, margin: "0 0 12px" }}>새 카테고리 추가</p>
                <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                  <input style={{ ...s.input, flex: 1 }} placeholder="카테고리 이름" value={newCatName} onChange={e => setNewCatName(e.target.value)} onKeyDown={e => e.key === "Enter" && addCategory()} />
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", maxWidth: 140 }}>
                    {COLORS.map(c => (
                      <div key={c} onClick={() => setNewCatColor(c)} style={{ width: 18, height: 18, borderRadius: "50%", background: c, cursor: "pointer", border: newCatColor === c ? "2px solid #222" : "2px solid transparent" }} />
                    ))}
                  </div>
                </div>
                <button onClick={addCategory} style={{ ...s.btn(true), width: "100%" }}>+ 추가</button>
              </div>
              <div style={s.card}>
                <p style={{ fontSize: 13, fontWeight: 500, margin: "0 0 12px" }}>카테고리 목록</p>
                {categories.map(cat => (
                  <div key={cat.name} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <span style={{ width: 12, height: 12, borderRadius: "50%", background: cat.color, flexShrink: 0 }}></span>
                    {editingCat === cat.name ? (
                      <input autoFocus defaultValue={cat.name}
                        onBlur={e => updateCategoryName(cat.name, e.target.value)}
                        onKeyDown={e => e.key === "Enter" && updateCategoryName(cat.name, e.target.value)}
                        style={{ ...s.input, flex: 1, fontSize: 13 }} />
                    ) : (
                      <span style={{ flex: 1, fontSize: 14 }}>{cat.name}</span>
                    )}
                    <div style={{ display: "flex", gap: 3 }}>
                      {COLORS.map(c => (
                        <div key={c} onClick={() => updateCategoryColor(cat.name, c)} style={{ width: 14, height: 14, borderRadius: "50%", background: c, cursor: "pointer", border: cat.color === c ? "2px solid #222" : "2px solid transparent" }} />
                      ))}
                    </div>
                    <button onClick={() => setEditingCat(editingCat === cat.name ? null : cat.name)} style={{ ...s.btn(false), padding: "3px 10px", fontSize: 12 }}>수정</button>
                    <button onClick={() => removeCategory(cat.name)} style={{ ...s.btn(false), padding: "3px 10px", fontSize: 12, color: "#E24B4A", borderColor: "#fcc" }}>삭제</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {tab === "guide" && (
            <div>
              {[
                {
                  emoji: "🧊", title: "냉장고 탭 — 재료 관리",
                  items: [
                    "재료명, 수량, 단위, 카테고리를 입력하고 + 추가 버튼을 누르면 냉장고에 추가돼요.",
                    "각 재료 카드 아래 '사용' 칸에 사용한 수량을 입력하고 적용을 누르면 수량이 줄어요. 0이 되면 자동으로 삭제돼요.",
                    "× 버튼을 누르면 재료를 바로 삭제할 수 있어요.",
                    "상단 카테고리 필터 버튼으로 원하는 종류만 볼 수 있어요.",
                  ]
                },
                {
                  emoji: "📷", title: "스캔하기 — 사진으로 재료 추가",
                  items: [
                    "📷 스캔하기: 카메라로 냉장고 내부, 영수증, 식품 사진을 찍으면 AI가 자동으로 재료를 인식해요.",
                    "🖼️ 사진 불러오기: 갤러리에 저장된 사진을 불러와서 스캔할 수 있어요.",
                    "인식된 목록을 확인하고 수정한 뒤 '냉장고에 추가' 버튼을 누르면 한번에 추가돼요.",
                    "잘못 인식된 항목은 × 버튼으로 제거하거나 직접 수정할 수 있어요.",
                  ]
                },
                {
                  emoji: "✨", title: "AI 추천 탭 — 레시피 추천",
                  items: [
                    "냉장고에 재료가 있어야 추천을 받을 수 있어요.",
                    "텍스트 칸에 원하는 조건을 자유롭게 입력해요. 예) '10분 안에 만들 수 있는 거', '다이어트 식단', '애들이 좋아할 요리'",
                    "▶ 유튜브 보기 버튼을 누르면 해당 요리 레시피 영상을 바로 찾아볼 수 있어요.",
                    "✅ 해먹었어요 버튼을 누르면 사용한 재료 목록이 뜨고, 수량을 확인 후 확정하면 냉장고에서 자동으로 차감돼요.",
                  ]
                },
                {
                  emoji: "👨‍👩‍👧", title: "가족 냉장고 — 가족과 공유",
                  items: [
                    "가족 냉장고 버튼을 누르면 공유 패널이 열려요.",
                    "➕ 가족 코드 만들기를 누르면 6자리 코드가 생성돼요. 이 코드를 가족에게 공유하세요!",
                    "가족은 코드 입력 후 참여 버튼을 누르면 같은 냉장고를 공유할 수 있어요.",
                    "가족 냉장고에 참여하면 어느 기기에서든 실시간으로 같은 냉장고 내용이 보여요.",
                    "나가기 버튼을 누르면 개인 냉장고로 돌아와요.",
                  ]
                },
                {
                  emoji: "📂", title: "카테고리 탭 — 카테고리 관리",
                  items: [
                    "새 카테고리를 추가하거나 기존 카테고리 이름과 색상을 변경할 수 있어요.",
                    "카테고리를 삭제하면 해당 재료들은 자동으로 '기타'로 이동해요.",
                  ]
                },
              ].map((section, i) => (
                <div key={i} style={s.card}>
                  <p style={{ fontSize: 15, fontWeight: 600, margin: "0 0 12px" }}>{section.emoji} {section.title}</p>
                  {section.items.map((item, j) => (
                    <div key={j} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "flex-start" }}>
                      <span style={{ color: "#1D9E75", fontWeight: 700, fontSize: 14, flexShrink: 0 }}>•</span>
                      <p style={{ fontSize: 13, color: "#444", margin: 0, lineHeight: 1.6 }}>{item}</p>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}