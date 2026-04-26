export function migrateGame(data, fallbackMode = "custom") {
  if (!data || typeof data !== "object") {
    return {
      title: "Новая игра",
      categories: [],
      gameMode: fallbackMode,
      modeSettings: {}
    };
  }

  return {
    title: data.title || "Новая игра",
    categories: (Array.isArray(data.categories) ? data.categories : []).map((cat) => ({
      name: cat?.name || "Раздел",
      questions: (Array.isArray(cat?.questions) ? cat.questions : []).map((q) => ({
        situation: q?.situation || { title: "", description: "", image: "" },
        question: q?.question || "",
        questionImage: q?.questionImage || q?.image || "",
        answer: q?.answer || "",
        answerImage: q?.answerImage || "",
        explanation: q?.explanation || { title: "", text: "", image: "" },
        time: Number(q?.time) || 30,
        price: Number(q?.price) || 100
      }))
    })),
    gameMode: data.gameMode || fallbackMode,
    modeSettings: data.modeSettings || {}
  };
}
