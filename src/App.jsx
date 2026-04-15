import { useState, useRef, useEffect, useMemo } from "react";
import { auth, provider, db } from "./firebase";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
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
  const [menuOpen, setMenuOpen] = useState(false);
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
  const cameraRef = useRef();
  const galleryRef = useRef();

  const dataPath = useMemo(() => {
    if (!user) return null;
    return familyCode ? `families/${familyCode}` : `users/${user.uid}`;
  }, [user, familyCode]);

  const getCatColor = (name) => categories.find(c => c.name === name)?.color || "#888";
  const catNames = categories.map(c => c.name);

  useEffect(() => {
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

  const login = () => signInWithPopup(auth, provider);
  const logout = () => {
    signOut(auth);
    setItems([]); setCategories(DEFAULT_CATEGORIES);
    setFamilyCode(null); setFamilyMembers([]); setLoaded(false);
  };

  const createFamily = async () => {
    const code = genCode();
    await set(ref(db, `families/${code}/members/${user.uid}`), { uid: user.uid, name: user.displayName, photo: user.photoURL });
    const itemsSnap = await get(ref(db, `users/${user.uid}/items`));
    const catsSnap = await get(ref(db, `users/${user.uid}/categories`));
    if (itemsSnap.val()) await set(ref(db, `families/${code}/items`), itemsSnap.val());
    if (catsSnap.val()) await set(ref(db, `families/${code}/categories`), catsSnap.val());
    await set(ref(db, `users/${user.uid}/familyCode`), code);
    setFamilyCode(code);
    setFamilyMsg("✅ 가족 코드 생성 완료!");
  };

  const joinFamily = async () => {
    const code = joinCodeInput.trim().toUpperCase();
    if (!code) return;
    const snap = await get(ref(db, `families/${code}`));
    if (!snap.val()) { setFamilyMsg("❌ 존재하지 않는 코드예요."); return; }
    await set(ref(db, `families/${code}/members/${user.uid}`), { uid: user.uid, name: user.displayName, photo: user.photoURL });
    await set(ref(db, `users/${user.uid}/familyCode`), code);
    setFamilyCode(code); setJoinCodeInput(""); setFamilyMsg("✅ 가족 냉장고에 참여했어요!");
  };

  const leaveFamily = async () => {
    if (!familyCode) return;
    await remove(ref(db, `families/${familyCode}/members/${user.uid}`));
    await remove(ref(db, `users/${user.uid}/familyCode`));
    setFamilyCode(null); setFamilyMembers([]); setLoaded(false);
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

  const updateCategoryColor = (name, color) => setCategories(prev => prev.map(c => c.name === name ? { ...c, color } : c));

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
    setScanning(true); setScanned([]); setTab("scan");
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = ev.target.result.split(",")[1];
      try {
        const catList = catNames.join("|");
        const text = await callClaude(`이 이미지를 분석해서 식료품 목록을 추출해주세요.
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
    setScanned([]); setTab("fridge");
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
    setAiLoading(true); setAiResult([]);
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
      return { item: matched, ingStr, used: numMatch ? parseFloat(numMatch[1]) : 1 };
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
    setItems(newItems); setRecipeModal(null);
  };

  const filtered = filterCat === "전체" ? items : items.filter(i => i.category === filterCat);

  const TABS = [
    { id: "fridge", emoji: "🧊", label: "냉장고" },
    { id: "ai", emoji: "✨", label: "AI 레시피 추천" },
    { id: "scan", emoji: "📷", label: "스캔하기" },
    { id: "gallery", emoji: "🖼️", label: "사진 불러오기" },
    { id: "family", emoji: "👨‍👩‍👧", label: "가족 냉장고" },
    { id: "cats", emoji: "📂", label: "카테고리 관리" },
    { id: "guide", emoji: "📖", label: "사용설명서" },
  ];

  const handleTabClick = (id) => {
    if (id === "scan") { cameraRef.current.click(); setMenuOpen(false); return; }
    if (id === "gallery") { galleryRef.current.click(); setMenuOpen(false); return; }
    if (id === "family") { setShowFamilyPanel(true); setMenuOpen(false); return; }
    setTab(id); setMenuOpen(false);
  };

  const currentTab = TABS.find(t => t.id === tab);

  const s = {
    card: { background: "#fff", borderRadius: 16, padding: "1rem", marginBottom: 10, boxShadow: "0 1px 4px #0000000d" },
    input: { padding: "10px 12px", borderRadius: 10, border: "1px solid #e8e8e8", fontSize: 14, width: "100%", boxSizing: "border-box", background: "#fafafa" },
    btn: (active, color) => ({ padding: "8px 16px", borderRadius: 10, border: `1.5px solid ${active ? (color||"#378ADD") : "#e8e8e8"}`, background: active ? (color||"#378ADD") : "#fff", color: active ? "#fff" : "#555", cursor: "pointer", fontSize: 13, fontWeight: active ? 600 : 400 }),
  };

  const guideData = [
    { emoji: "🧊", title: "냉장고 탭 — 재료 관리", items: ["재료명, 수량, 단위, 카테고리를 입력하고 + 추가 버튼을 누르면 냉장고에 추가돼요.", "각 재료 카드 아래 '사용' 칸에 사용한 수량을 입력하고 적용을 누르면 수량이 줄어요. 0이 되면 자동으로 삭제돼요.", "× 버튼을 누르면 재료를 바로 삭제할 수 있어요.", "상단 카테고리 필터 버튼으로 원하는 종류만 볼 수 있어요."] },
    { emoji: "📷", title: "스캔 / 사진 불러오기", items: ["📷 스캔하기: 카메라로 냉장고 내부, 영수증, 식품 사진을 찍으면 AI가 자동으로 재료를 인식해요.", "🖼️ 사진 불러오기: 갤러리에 저장된 사진을 불러와서 스캔할 수 있어요.", "인식된 목록을 확인·수정한 뒤 '냉장고에 추가' 버튼을 누르면 한번에 추가돼요."] },
    { emoji: "✨", title: "AI 레시피 추천", items: ["냉장고에 재료가 있어야 추천을 받을 수 있어요.", "원하는 조건을 자유롭게 입력해요. 예) '10분 안에 만들 수 있는 거', '다이어트 식단'", "▶ 유튜브 보기 버튼으로 레시피 영상을 바로 찾아볼 수 있어요.", "✅ 해먹었어요 버튼으로 사용한 재료를 냉장고에서 자동 차감할 수 있어요."] },
    { emoji: "👨‍👩‍👧", title: "가족 냉장고", items: ["메뉴에서 '가족 냉장고'를 누르면 공유 패널이 열려요.", "➕ 가족 코드 만들기로 6자리 코드를 생성하고 가족에게 공유하세요!", "가족은 코드 입력 후 참여하면 같은 냉장고를 실시간으로 함께 관리할 수 있어요."] },
    { emoji: "📂", title: "카테고리 관리", items: ["새 카테고리를 추가하거나 기존 카테고리 이름과 색상을 변경할 수 있어요.", "카테고리를 삭제하면 해당 재료들은 자동으로 '기타'로 이동해요."] },
  ];

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: "#f5f6fa", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", color: "#1a1a1a" }}>

      {/* 사이드 메뉴 오버레이 */}
      {menuOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={() => setMenuOpen(false)}>
          <div style={{ position: "absolute", inset: 0, background: "#000", opacity: 0.35 }} />
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 280, background: "#fff", boxShadow: "4px 0 24px #0002", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>
            {/* 메뉴 헤더 */}
            <div style={{ background: "linear-gradient(135deg, #1D9E75, #0F6E56)", padding: "2rem 1.5rem 1.5rem", color: "#fff" }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🧊</div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>냉장고 트래커</div>
              {user && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
                  <img src={user.photoURL} width={32} height={32} style={{ borderRadius: "50%", border: "2px solid #ffffff66" }} alt="" />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{user.displayName}</div>
                    {familyCode && <div style={{ fontSize: 11, opacity: 0.8 }}>👨‍👩‍👧 가족 냉장고</div>}
                  </div>
                </div>
              )}
            </div>

            {/* 메뉴 항목 */}
            <div style={{ flex: 1, overflowY: "auto", padding: "0.75rem 0" }}>
              {TABS.map(t => (
                <button key={t.id} onClick={() => handleTabClick(t.id)}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", background: tab === t.id ? "#f0faf5" : "none", border: "none", cursor: "pointer", fontSize: 15, color: tab === t.id ? "#1D9E75" : "#333", fontWeight: tab === t.id ? 600 : 400, borderLeft: tab === t.id ? "3px solid #1D9E75" : "3px solid transparent", textAlign: "left" }}>
                  <span style={{ fontSize: 18 }}>{t.emoji}</span>
                  {t.label}
                </button>
              ))}
            </div>

            {/* 로그아웃 */}
            {user && (
              <div style={{ padding: "1rem 1.25rem", borderTop: "1px solid #f0f0f0" }}>
                <button onClick={() => { logout(); setMenuOpen(false); }}
                  style={{ width: "100%", padding: "10px", borderRadius: 10, border: "1.5px solid #fcc", background: "#fff5f5", color: "#E24B4A", cursor: "pointer", fontSize: 14, fontWeight: 500 }}>
                  로그아웃
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 해먹었어요 모달 */}
      {recipeModal && (
        <div style={{ position: "fixed", inset: 0, background: "#0006", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: "1rem" }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: "1.5rem", width: "100%", maxWidth: 420, boxShadow: "0 8px 40px #0003" }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 17, fontWeight: 700 }}>✅ {recipeModal.recipe.name}</h3>
            <p style={{ fontSize: 13, color: "#888", margin: "0 0 16px" }}>사용한 재료와 수량을 확인해주세요!</p>
            {recipeModal.usages.map((u, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                {u.item ? (
                  <>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: getCatColor(u.item.category), flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 14 }}>{u.item.name}</span>
                    <span style={{ fontSize: 12, color: "#aaa" }}>보유 {u.item.qty}{u.item.unit}</span>
                    <input type="number" value={u.used} min={0} max={u.item.qty}
                      onChange={e => setRecipeModal(prev => ({ ...prev, usages: prev.usages.map((x, j) => j === i ? { ...x, used: parseFloat(e.target.value) || 0 } : x) }))}
                      style={{ ...s.input, width: 60, fontSize: 13 }} />
                    <span style={{ fontSize: 12, color: "#aaa" }}>{u.item.unit}</span>
                  </>
                ) : (
                  <span style={{ flex: 1, fontSize: 13, color: "#bbb" }}>{u.ingStr} (냉장고에 없음)</span>
                )}
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={confirmRecipe} style={{ ...s.btn(true), flex: 1, padding: "11px" }}>확정 — 재료 차감</button>
              <button onClick={() => setRecipeModal(null)} style={{ ...s.btn(false), padding: "11px 20px" }}>취소</button>
            </div>
          </div>
        </div>
      )}

      {/* 가족 냉장고 모달 */}
      {showFamilyPanel && (
        <div style={{ position: "fixed", inset: 0, background: "#0006", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: "1rem" }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: "1.5rem", width: "100%", maxWidth: 420, boxShadow: "0 8px 40px #0003" }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 17, fontWeight: 700 }}>👨‍👩‍👧 가족 냉장고 공유</h3>
            {!familyCode ? (
              <>
                <p style={{ fontSize: 13, color: "#888", marginBottom: 16 }}>가족 코드를 만들거나 기존 코드로 참여하세요!</p>
                <button onClick={createFamily} style={{ ...s.btn(true), width: "100%", marginBottom: 12, padding: "12px" }}>➕ 가족 코드 만들기</button>
                <div style={{ display: "flex", gap: 8 }}>
                  <input style={{ ...s.input, flex: 1 }} placeholder="가족 코드 6자리 입력" value={joinCodeInput} onChange={e => setJoinCodeInput(e.target.value.toUpperCase())} maxLength={6} />
                  <button onClick={joinFamily} style={{ ...s.btn(true), padding: "10px 18px" }}>참여</button>
                </div>
              </>
            ) : (
              <>
                <div style={{ background: "linear-gradient(135deg, #f0faf5, #e8f8f2)", borderRadius: 14, padding: "16px", marginBottom: 16, textAlign: "center" }}>
                  <p style={{ fontSize: 12, color: "#888", margin: "0 0 6px" }}>가족 코드</p>
                  <p style={{ fontSize: 32, fontWeight: 800, letterSpacing: 8, color: "#1D9E75", margin: 0 }}>{familyCode}</p>
                  <p style={{ fontSize: 12, color: "#aaa", margin: "6px 0 0" }}>이 코드를 가족에게 공유하세요!</p>
                </div>
                <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 10px", color: "#555" }}>멤버 ({familyMembers.length}명)</p>
                {familyMembers.map((m, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <img src={m.photo} width={32} height={32} style={{ borderRadius: "50%" }} alt="" />
                    <span style={{ fontSize: 14, flex: 1 }}>{m.name}</span>
                    {m.uid === user.uid && <span style={{ fontSize: 11, color: "#378ADD", background: "#e8f4ff", padding: "2px 8px", borderRadius: 8 }}>나</span>}
                  </div>
                ))}
                <button onClick={leaveFamily} style={{ ...s.btn(false), width: "100%", marginTop: 12, color: "#E24B4A", borderColor: "#fcc", padding: "11px" }}>가족 냉장고 나가기</button>
              </>
            )}
            {familyMsg && <p style={{ fontSize: 13, color: "#1D9E75", marginTop: 12, textAlign: "center" }}>{familyMsg}</p>}
            <button onClick={() => { setShowFamilyPanel(false); setFamilyMsg(""); }} style={{ ...s.btn(false), width: "100%", marginTop: 8, padding: "11px" }}>닫기</button>
          </div>
        </div>
      )}

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={handlePhoto} />
      <input ref={galleryRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handlePhoto} />

      {/* 로딩 */}
      {authLoading && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", flexDirection: "column", gap: 12, color: "#aaa" }}>
          <div style={{ fontSize: 48 }}>🧊</div>
          <p style={{ margin: 0, fontSize: 14 }}>로딩 중...</p>
        </div>
      )}

      {/* 로그인 화면 */}
      {!authLoading && !user && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", flexDirection: "column", padding: "2rem" }}>
          <div style={{ background: "#fff", borderRadius: 24, padding: "3rem 2rem", textAlign: "center", boxShadow: "0 4px 32px #0000000f", width: "100%", maxWidth: 360 }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>🧊</div>
            <h2 style={{ fontSize: 24, fontWeight: 800, margin: "0 0 8px", color: "#1a1a1a" }}>냉장고 트래커</h2>
            <p style={{ color: "#888", marginBottom: 32, fontSize: 14, lineHeight: 1.6 }}>냉장고 속 재료를 스마트하게 관리하고<br/>AI 레시피 추천을 받아보세요!</p>
            <button onClick={login} style={{ padding: "13px 28px", borderRadius: 12, border: "1.5px solid #e8e8e8", background: "#fff", fontSize: 15, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 10, boxShadow: "0 2px 12px #0001", fontWeight: 500, width: "100%", justifyContent: "center" }}>
              <img src="https://www.google.com/favicon.ico" width={20} height={20} alt="google" />
              Google로 로그인
            </button>
          </div>
        </div>
      )}

      {/* 메인 앱 */}
      {!authLoading && user && (
        <div style={{ paddingBottom: "2rem" }}>
          {/* 헤더 */}
          <div style={{ background: "#fff", padding: "1rem 1.25rem", display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 1px 0 #f0f0f0", position: "sticky", top: 0, zIndex: 100 }}>
            <button onClick={() => setMenuOpen(true)} style={{ background: "none", border: "none", cursor: "pointer", padding: 6, borderRadius: 8, display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ display: "block", width: 22, height: 2, background: "#333", borderRadius: 2 }} />
              <span style={{ display: "block", width: 22, height: 2, background: "#333", borderRadius: 2 }} />
              <span style={{ display: "block", width: 22, height: 2, background: "#333", borderRadius: 2 }} />
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 18 }}>{currentTab?.emoji || "🧊"}</span>
              <span style={{ fontWeight: 700, fontSize: 17 }}>{currentTab?.label || "냉장고"}</span>
              {familyCode && <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 8, background: "#e8f4ff", color: "#378ADD", fontWeight: 600 }}>가족</span>}
            </div>
            <img src={user.photoURL} width={32} height={32} style={{ borderRadius: "50%", border: "2px solid #f0f0f0" }} alt="profile" />
          </div>

          {/* 퀵 액션 버튼 */}
          <div style={{ display: "flex", gap: 8, padding: "0.875rem 1rem 0" }}>
            <button onClick={() => cameraRef.current.click()} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "12px 8px", borderRadius: 14, border: "1.5px solid #e8e8e8", background: "#fff", cursor: "pointer", boxShadow: "0 1px 4px #0000000d" }}>
              <span style={{ fontSize: 22 }}>📷</span>
              <span style={{ fontSize: 11, color: "#555", fontWeight: 600 }}>카메라 스캔</span>
            </button>
            <button onClick={() => galleryRef.current.click()} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "12px 8px", borderRadius: 14, border: "1.5px solid #e8e8e8", background: "#fff", cursor: "pointer", boxShadow: "0 1px 4px #0000000d" }}>
              <span style={{ fontSize: 22 }}>🖼️</span>
              <span style={{ fontSize: 11, color: "#555", fontWeight: 600 }}>사진 불러오기</span>
            </button>
            <button onClick={() => setTab("ai")} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "12px 8px", borderRadius: 14, border: `1.5px solid ${tab === "ai" ? "#378ADD" : "#e8e8e8"}`, background: tab === "ai" ? "#e8f4ff" : "#fff", cursor: "pointer", boxShadow: "0 1px 4px #0000000d" }}>
              <span style={{ fontSize: 22 }}>✨</span>
              <span style={{ fontSize: 11, color: tab === "ai" ? "#378ADD" : "#555", fontWeight: 600 }}>AI 레시피</span>
            </button>
          </div>

          <div style={{ padding: "0.75rem 1rem 0" }}>

            {/* 스캔 탭 */}
            {tab === "scan" && (
              <div style={s.card}>
                {scanning ? (
                  <div style={{ textAlign: "center", padding: "3rem", color: "#888" }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
                    <p style={{ margin: 0, fontSize: 15 }}>이미지 분석 중...</p>
                  </div>
                ) : scanned.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "3rem", color: "#bbb" }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>📷</div>
                    <p style={{ margin: 0 }}>인식된 항목이 없어요.</p>
                  </div>
                ) : (
                  <>
                    <p style={{ fontSize: 13, color: "#888", margin: "0 0 14px" }}>인식된 항목을 확인하고 수정해주세요!</p>
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
                    <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                      <button onClick={confirmScanned} style={{ ...s.btn(true), flex: 1, padding: "11px" }}>냉장고에 추가 ({scanned.length}개)</button>
                      <button onClick={() => { setScanned([]); setTab("fridge"); }} style={{ ...s.btn(false), padding: "11px 16px" }}>취소</button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* 냉장고 탭 */}
            {tab === "fridge" && (
              <>
                <div style={s.card}>
                  <p style={{ fontSize: 12, color: "#aaa", margin: "0 0 10px", fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase" }}>재료 직접 추가</p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 60px 50px 1fr", gap: 6, marginBottom: 10 }}>
                    <input style={s.input} placeholder="재료명" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} onKeyDown={e => e.key === "Enter" && addItem()} />
                    <input type="number" style={s.input} placeholder="수량" value={form.qty} onChange={e => setForm(p => ({ ...p, qty: e.target.value }))} />
                    <input style={s.input} placeholder="단위" value={form.unit} onChange={e => setForm(p => ({ ...p, unit: e.target.value }))} />
                    <select style={s.input} value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
                      {catNames.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <button onClick={addItem} style={{ ...s.btn(true), width: "100%", padding: "11px", fontSize: 14 }}>+ 추가하기</button>
                </div>

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                  {["전체", ...catNames].map(c => (
                    <button key={c} onClick={() => setFilterCat(c)} style={{ fontSize: 12, padding: "5px 12px", borderRadius: 20, cursor: "pointer", background: filterCat === c ? (getCatColor(c) || "#378ADD") : "#fff", color: filterCat === c ? "#fff" : "#666", border: `1.5px solid ${filterCat === c ? (getCatColor(c)||"#378ADD") : "#e8e8e8"}`, fontWeight: filterCat === c ? 600 : 400 }}>{c}</button>
                  ))}
                </div>

                {filtered.length === 0 && (
                  <div style={{ textAlign: "center", padding: "4rem 0", color: "#ccc" }}>
                    <div style={{ fontSize: 48, marginBottom: 12 }}>🧊</div>
                    <p style={{ margin: 0, fontSize: 14 }}>재료를 추가하거나 사진을 스캔해보세요!</p>
                  </div>
                )}

                {filtered.map(item => (
                  <div key={item.id} style={{ ...s.card, padding: "0.875rem 1rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                      <span style={{ width: 10, height: 10, borderRadius: "50%", background: getCatColor(item.category), flexShrink: 0 }}></span>
                      <span style={{ fontWeight: 600, fontSize: 15, flex: 1 }}>{item.name}</span>
                      <span style={{ fontSize: 13, color: "#666", fontWeight: 500 }}>{item.qty}{item.unit}</span>
                      <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 8, background: getCatColor(item.category) + "18", color: getCatColor(item.category), fontWeight: 600 }}>{item.category}</span>
                      <button onClick={() => removeItem(item.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#ccc", fontSize: 18, lineHeight: 1 }}>×</button>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 20 }}>
                      <span style={{ fontSize: 12, color: "#bbb" }}>사용량</span>
                      <input type="number" placeholder="0" value={useQty[item.id] || ""} onChange={e => setUseQty(p => ({ ...p, [item.id]: e.target.value }))} style={{ ...s.input, width: 65, fontSize: 13 }} />
                      <span style={{ fontSize: 12, color: "#bbb" }}>{item.unit}</span>
                      <button onClick={() => applyUse(item)} style={{ ...s.btn(false), padding: "5px 14px", fontSize: 12 }}>적용</button>
                    </div>
                  </div>
                ))}
              </>
            )}

            {/* AI 추천 탭 */}
            {tab === "ai" && (
              <div>
                <div style={s.card}>
                  <p style={{ fontSize: 12, color: "#aaa", margin: "0 0 6px", fontWeight: 600 }}>현재 재료</p>
                  <p style={{ fontSize: 13, color: "#555", margin: "0 0 14px", lineHeight: 1.5 }}>{items.length === 0 ? "냉장고가 비어있어요" : items.map(i => i.name).join(", ")}</p>
                  <textarea placeholder="예) 다이어트 식단 / 10분 안에 만들 수 있는 거 / 애들이 좋아할 만한 요리" value={aiInput} onChange={e => setAiInput(e.target.value)} style={{ ...s.input, height: 90, resize: "none", marginBottom: 10 }} />
                  <button onClick={callAI} disabled={aiLoading || items.length === 0 || !aiInput.trim()} style={{ ...s.btn(true), width: "100%", padding: "12px", fontSize: 14, opacity: (items.length===0||!aiInput.trim()) ? 0.4 : 1 }}>
                    {aiLoading ? "추천 중..." : "레시피 추천받기 ✨"}
                  </button>
                </div>
                {aiResult === "error" && <p style={{ color: "#E24B4A", fontSize: 13, textAlign: "center" }}>오류가 생겼어요. 다시 시도해주세요.</p>}
                {Array.isArray(aiResult) && aiResult.map((r, i) => (
                  <div key={i} style={s.card}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <span style={{ fontWeight: 700, fontSize: 16, flex: 1 }}>{r.name}</span>
                      <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 8, background: "#e8f4ff", color: "#378ADD", fontWeight: 600 }}>{r.difficulty}</span>
                    </div>
                    <p style={{ fontSize: 13, color: "#777", margin: "0 0 8px", lineHeight: 1.5 }}>재료: {r.ingredients.join(", ")}</p>
                    <p style={{ fontSize: 13, color: "#444", margin: "0 0 14px", lineHeight: 1.5 }}>💡 {r.tip}</p>
                    <div style={{ display: "flex", gap: 8 }}>
                      <a href={`https://www.youtube.com/results?search_query=${encodeURIComponent(r.name + " 레시피")}`} target="_blank" rel="noopener noreferrer"
                        style={{ ...s.btn(false), fontSize: 12, padding: "7px 14px", textDecoration: "none", color: "#E24B4A", borderColor: "#fcc", display: "inline-flex", alignItems: "center", gap: 4 }}>
                        ▶ 유튜브
                      </a>
                      <button onClick={() => openRecipeModal(r)} style={{ ...s.btn(false), fontSize: 12, padding: "7px 14px", color: "#1D9E75", borderColor: "#b8e8d8" }}>
                        ✅ 해먹었어요
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 카테고리 탭 */}
            {tab === "cats" && (
              <div>
                <div style={s.card}>
                  <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 12px" }}>새 카테고리 추가</p>
                  <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
                    <input style={{ ...s.input, flex: 1 }} placeholder="카테고리 이름" value={newCatName} onChange={e => setNewCatName(e.target.value)} onKeyDown={e => e.key === "Enter" && addCategory()} />
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", maxWidth: 140 }}>
                      {COLORS.map(c => (
                        <div key={c} onClick={() => setNewCatColor(c)} style={{ width: 20, height: 20, borderRadius: "50%", background: c, cursor: "pointer", border: newCatColor === c ? "2.5px solid #222" : "2.5px solid transparent" }} />
                      ))}
                    </div>
                  </div>
                  <button onClick={addCategory} style={{ ...s.btn(true), width: "100%", padding: "11px" }}>+ 추가</button>
                </div>
                <div style={s.card}>
                  <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 14px" }}>카테고리 목록</p>
                  {categories.map(cat => (
                    <div key={cat.name} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
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
                      <button onClick={() => setEditingCat(editingCat === cat.name ? null : cat.name)} style={{ ...s.btn(false), padding: "4px 10px", fontSize: 12 }}>수정</button>
                      <button onClick={() => removeCategory(cat.name)} style={{ ...s.btn(false), padding: "4px 10px", fontSize: 12, color: "#E24B4A", borderColor: "#fcc" }}>삭제</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 사용설명서 탭 */}
            {tab === "guide" && (
              <div>
                <div style={{ ...s.card, background: "linear-gradient(135deg, #f0faf5, #e8f8f2)", border: "none" }}>
                  <p style={{ fontSize: 15, color: "#1D9E75", fontWeight: 700, margin: "0 0 6px" }}>👋 냉장고 트래커에 오신 것을 환영해요!</p>
                  <p style={{ fontSize: 13, color: "#555", margin: 0, lineHeight: 1.6 }}>냉장고 속 재료를 쉽게 관리하고, AI가 오늘의 요리를 추천해드려요!</p>
                </div>
                {guideData.map((section, i) => (
                  <div key={i} style={s.card}>
                    <p style={{ fontSize: 15, fontWeight: 700, margin: "0 0 12px" }}>{section.emoji} {section.title}</p>
                    {section.items.map((item, j) => (
                      <div key={j} style={{ display: "flex", gap: 10, marginBottom: 10, alignItems: "flex-start" }}>
                        <span style={{ color: "#1D9E75", fontWeight: 700, fontSize: 16, flexShrink: 0, marginTop: 1 }}>•</span>
                        <p style={{ fontSize: 13, color: "#555", margin: 0, lineHeight: 1.6 }}>{item}</p>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
        </div>
      )}
    </div>
  );
}