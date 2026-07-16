"use client"

import { useMemo, useState } from "react"
import {
  createDefaultIdentityContract,
  type SessionIdentityContract,
  type StoryVariant,
} from "@/lib/story-variants"

interface ScenarioOption { code: string; title: string }
function emptyVariant(code: string, index: number): StoryVariant {
  return { id: `${code}-V${String(index).padStart(2, "0")}`, scenarioCode: code, title: "", persona: "", source: "模拟来电", premise: "", objective: "", pressureTactics: [], opening: "", fallbackLines: [], identityContract: createDefaultIdentityContract(), enabled: false, version: 1, updatedAt: new Date().toISOString() }
}

export function StoryVariantManager({ scenarios }: { scenarios: ScenarioOption[] }) {
  const [token, setToken] = useState("")
  const [variants, setVariants] = useState<StoryVariant[]>([])
  const [filter, setFilter] = useState(scenarios[0]?.code ?? "SC-01")
  const [draft, setDraft] = useState<StoryVariant | null>(null)
  const [status, setStatus] = useState("请输入服务器配置的管理令牌后加载。")
  const [busy, setBusy] = useState(false)
  const visible = useMemo(() => variants.filter((item) => item.scenarioCode === filter).sort((a, b) => a.id.localeCompare(b.id)), [filter, variants])

  async function request(url: string, init?: RequestInit) {
    const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init?.headers } })
    const data = await response.json()
    if (!response.ok) throw new Error([data.error, ...(data.details ?? [])].filter(Boolean).join(" "))
    return data
  }
  async function load() {
    setBusy(true)
    try { const data = await request("/api/story-variants?includeDisabled=1"); setVariants(data.variants); setStatus(`已加载 ${data.variants.length} 个变体，来源：${data.source}。`) }
    catch (error) { setStatus(error instanceof Error ? error.message : "加载失败。") }
    finally { setBusy(false) }
  }
  async function save() {
    if (!draft) return
    setBusy(true)
    try {
      const data = await request("/api/story-variants", { method: "POST", body: JSON.stringify(draft) })
      setVariants((items) => [...items.filter((item) => item.id !== data.variant.id), data.variant]); setDraft(data.variant); setStatus(`已保存 ${data.variant.id}，来源：${data.source}。`)
    } catch (error) { setStatus(error instanceof Error ? error.message : "保存失败。") }
    finally { setBusy(false) }
  }
  async function remove() {
    if (!draft || !window.confirm(`确定删除 ${draft.id} 吗？`)) return
    setBusy(true)
    try { await request(`/api/story-variants?id=${encodeURIComponent(draft.id)}`, { method: "DELETE" }); setVariants((items) => items.filter((item) => item.id !== draft.id)); setDraft(null); setStatus("已删除变体。") }
    catch (error) { setStatus(error instanceof Error ? error.message : "删除失败。") }
    finally { setBusy(false) }
  }
  function patch<K extends keyof StoryVariant>(key: K, value: StoryVariant[K]) { setDraft((current) => current ? { ...current, [key]: value } : current) }
  function patchIdentity<K extends keyof SessionIdentityContract>(key: K, value: SessionIdentityContract[K]) {
    setDraft((current) => current ? { ...current, identityContract: { ...current.identityContract, [key]: value } } : current)
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-900 md:p-8"><div className="mx-auto max-w-7xl space-y-4">
      <header className="rounded-2xl border bg-white p-5 shadow-sm"><h1 className="text-2xl font-bold">银龄智盾故事变体维护</h1><p className="mt-1 text-sm text-slate-600">维护受控剧本卡。管理令牌只保存在当前页面内存，刷新后清除。</p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row"><input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="管理令牌" className="min-w-0 flex-1 rounded-lg border px-3 py-2" /><button disabled={busy || !token} onClick={load} className="rounded-lg bg-slate-900 px-5 py-2 text-white disabled:opacity-50">连接并刷新</button></div><p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-sm">{status}</p>
      </header>
      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <section className="rounded-2xl border bg-white p-4 shadow-sm"><div className="flex gap-2"><select value={filter} onChange={(event) => setFilter(event.target.value)} className="min-w-0 flex-1 rounded-lg border px-3 py-2">{scenarios.map((item) => <option key={item.code} value={item.code}>{item.code} {item.title}</option>)}</select><button onClick={() => setDraft(emptyVariant(filter, visible.length + 1))} className="rounded-lg border px-3 py-2">新建</button></div>
          <div className="mt-3 space-y-2">{visible.map((item) => <button key={item.id} onClick={() => setDraft({ ...item, pressureTactics: [...item.pressureTactics], fallbackLines: [...item.fallbackLines] })} className={`w-full rounded-xl border p-3 text-left ${draft?.id === item.id ? "border-blue-500 bg-blue-50" : "bg-white"}`}><div className="flex justify-between gap-2"><strong>{item.title}</strong><span className={item.enabled ? "text-emerald-700" : "text-slate-500"}>{item.enabled ? "已启用" : "已停用"}</span></div><div className="mt-1 text-xs text-slate-500">{item.id} · {item.persona}</div></button>)}</div>
        </section>
        <section className="rounded-2xl border bg-white p-5 shadow-sm">{!draft ? <p className="text-slate-500">选择或新建一个故事变体。</p> : <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">变体 ID<input value={draft.id} onChange={(event) => patch("id", event.target.value.toUpperCase())} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
          <label className="text-sm">所属场景<select value={draft.scenarioCode} onChange={(event) => { patch("scenarioCode", event.target.value); setFilter(event.target.value) }} className="mt-1 w-full rounded-lg border px-3 py-2">{scenarios.map((item) => <option key={item.code} value={item.code}>{item.code} {item.title}</option>)}</select></label>
          <label className="text-sm">标题<input value={draft.title} onChange={(event) => patch("title", event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" /></label><label className="text-sm">人物身份<input value={draft.persona} onChange={(event) => patch("persona", event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
          <label className="text-sm sm:col-span-2">模拟来源<input value={draft.source} onChange={(event) => patch("source", event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" /></label><label className="text-sm sm:col-span-2">事件背景<textarea value={draft.premise} onChange={(event) => patch("premise", event.target.value)} rows={3} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
          <label className="text-sm sm:col-span-2">诈骗目标<input value={draft.objective} onChange={(event) => patch("objective", event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" /></label><label className="text-sm sm:col-span-2">压力手法（顿号、逗号或换行分隔）<input value={draft.pressureTactics.join("、")} onChange={(event) => patch("pressureTactics", event.target.value.split(/[、，,\n]/u).map((item) => item.trim()).filter(Boolean))} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
          <label className="text-sm sm:col-span-2">开场白<textarea value={draft.opening} onChange={(event) => patch("opening", event.target.value)} rows={3} className="mt-1 w-full rounded-lg border px-3 py-2" /></label><label className="text-sm sm:col-span-2">fallback 话术（每行一条）<textarea value={draft.fallbackLines.join("\n")} onChange={(event) => patch("fallbackLines", event.target.value.split("\n").map((item) => item.trim()).filter(Boolean))} rows={5} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
          <div className="sm:col-span-2 border-t pt-4"><h2 className="font-semibold">本场身份契约</h2><p className="mt-1 text-xs text-slate-500">受训者默认按未知性别处理，所有对话、语音和报告都受该契约约束。</p></div>
          <label className="text-sm">受训者称谓<input value={draft.identityContract.trainee.address} onChange={(event) => patchIdentity("trainee", { ...draft.identityContract.trainee, address: event.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
          <label className="text-sm">来电人角色<input value={draft.identityContract.caller.role} onChange={(event) => patchIdentity("caller", { ...draft.identityContract.caller, role: event.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
          <label className="text-sm">来电人显示姓名<input value={draft.identityContract.caller.displayName} onChange={(event) => patchIdentity("caller", { ...draft.identityContract.caller, displayName: event.target.value })} placeholder="可留空" className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
          <label className="text-sm">来电人性别<select value={draft.identityContract.caller.gender} onChange={(event) => patchIdentity("caller", { ...draft.identityContract.caller, gender: event.target.value as SessionIdentityContract["caller"]["gender"] })} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="unknown">未知</option><option value="female">女性</option><option value="male">男性</option></select></label>
          <label className="text-sm">来电人音色配置<input value={draft.identityContract.caller.voiceProfile} onChange={(event) => patchIdentity("caller", { ...draft.identityContract.caller, voiceProfile: event.target.value })} placeholder="scenario-default / young-female" className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
          <label className="text-sm">事件对象类型<select value={draft.identityContract.subject.kind} onChange={(event) => patchIdentity("subject", { ...draft.identityContract.subject, kind: event.target.value as SessionIdentityContract["subject"]["kind"] })} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="event">事件</option><option value="account">账户</option><option value="relative">亲属</option></select></label>
          <label className="text-sm">亲属关系<input value={draft.identityContract.subject.relation} onChange={(event) => patchIdentity("subject", { ...draft.identityContract.subject, relation: event.target.value })} placeholder="如：女儿、孙子、亲属" className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
          <label className="text-sm">事件对象姓名<input value={draft.identityContract.subject.name} onChange={(event) => patchIdentity("subject", { ...draft.identityContract.subject, name: event.target.value })} placeholder="可留空" className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
          <label className="text-sm">事件对象性别<select value={draft.identityContract.subject.gender} onChange={(event) => patchIdentity("subject", { ...draft.identityContract.subject, gender: event.target.value as SessionIdentityContract["subject"]["gender"] })} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="unknown">未知</option><option value="female">女性</option><option value="male">男性</option></select></label>
          <label className="text-sm">事件对象年龄层<select value={draft.identityContract.subject.ageGroup} onChange={(event) => patchIdentity("subject", { ...draft.identityContract.subject, ageGroup: event.target.value as SessionIdentityContract["subject"]["ageGroup"] })} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="unknown">未知</option><option value="young">年轻</option><option value="adult">成年</option><option value="senior">老年</option></select></label>
          <label className="text-sm sm:col-span-2">允许称呼（顿号、逗号或换行分隔）<input value={draft.identityContract.subject.aliases.join("、")} onChange={(event) => patchIdentity("subject", { ...draft.identityContract.subject, aliases: event.target.value.split(/[、，,\n]/u).map((item) => item.trim()).filter(Boolean) })} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
          <label className="text-sm sm:col-span-2">禁止身份与称谓（顿号、逗号或换行分隔）<input value={draft.identityContract.forbiddenTerms.join("、")} onChange={(event) => patchIdentity("forbiddenTerms", event.target.value.split(/[、，,\n]/u).map((item) => item.trim()).filter(Boolean))} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.identityContract.distressCue?.enabled === true} onChange={(event) => patchIdentity("distressCue", { enabled: event.target.checked, text: draft.identityContract.distressCue?.text ?? "", voice: draft.identityContract.distressCue?.voice || (draft.identityContract.subject.gender === "female" ? "Mia" : ""), instructions: draft.identityContract.distressCue?.instructions ?? "", fallbackMode: event.target.checked ? "speech" : "ambient-only" })} />启用匹配的亲属求救人声</label>
          <label className="text-sm">求救音色<input value={draft.identityContract.distressCue?.voice ?? ""} disabled={!draft.identityContract.distressCue?.enabled} onChange={(event) => patchIdentity("distressCue", { enabled: true, text: draft.identityContract.distressCue?.text ?? "", voice: event.target.value, instructions: draft.identityContract.distressCue?.instructions ?? "", fallbackMode: "speech" })} placeholder="如 Mia" className="mt-1 w-full rounded-lg border px-3 py-2 disabled:bg-slate-100" /></label>
          <label className="text-sm sm:col-span-2">求救语音文本<input value={draft.identityContract.distressCue?.text ?? ""} disabled={!draft.identityContract.distressCue?.enabled} onChange={(event) => patchIdentity("distressCue", { enabled: true, text: event.target.value, voice: draft.identityContract.distressCue?.voice || "Mia", instructions: draft.identityContract.distressCue?.instructions ?? "", fallbackMode: "speech" })} className="mt-1 w-full rounded-lg border px-3 py-2 disabled:bg-slate-100" /></label>
          <label className="text-sm sm:col-span-2">求救语气说明<input value={draft.identityContract.distressCue?.instructions ?? ""} disabled={!draft.identityContract.distressCue?.enabled} onChange={(event) => patchIdentity("distressCue", { enabled: true, text: draft.identityContract.distressCue?.text ?? "", voice: draft.identityContract.distressCue?.voice || "Mia", instructions: event.target.value, fallbackMode: "speech" })} className="mt-1 w-full rounded-lg border px-3 py-2 disabled:bg-slate-100" /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.enabled} onChange={(event) => patch("enabled", event.target.checked)} />启用该变体</label><div className="flex justify-end gap-2"><button onClick={remove} disabled={busy} className="rounded-lg border border-red-300 px-4 py-2 text-red-700">删除</button><button onClick={save} disabled={busy} className="rounded-lg bg-blue-600 px-5 py-2 text-white disabled:opacity-50">保存变体</button></div>
        </div>}</section>
      </div>
    </div></main>
  )
}
