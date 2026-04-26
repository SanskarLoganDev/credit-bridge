import os
import asyncio
import anthropic

client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])


async def generate_narrative(score_data: dict, signals: dict, applicant_name: str) -> str:
    """Call Claude to write a plain-English credit narrative"""
    score = score_data["final_score"]
    grade = score_data["grade"]
    recommendation = score_data["recommendation"]

    signal_summary = "\n".join([
        f"- {k.replace('_', ' ').title()}: {v['score']}/100 — {v.get('evidence', 'No evidence')}"
        for k, v in signals.items()
    ])

    prompt = f"""You are a senior credit analyst at a micro-lending institution.
Write a concise 3-4 sentence credit assessment for an applicant named {applicant_name}.

Credit score: {score}/850 ({grade})
Recommendation: {recommendation}

Signal breakdown:
{signal_summary}

Instructions:
- Be factual and cite specific evidence from the signals
- Use plain English — avoid financial jargon
- Be direct about the recommendation
- End with one sentence comparing to similar applicants if the score is above 600
- Keep it under 80 words
- Do NOT start with "Based on" or "According to"
- Sound like a real human analyst, not a robot"""

    loop = asyncio.get_event_loop()

    def _call():
        msg = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}]
        )
        return msg.content[0].text.strip()

    return await loop.run_in_executor(None, _call)
