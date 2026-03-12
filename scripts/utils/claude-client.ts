import Anthropic from '@anthropic-ai/sdk';

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic();
  }
  return _client;
}

export interface GeneratedPost {
  title: string;
  description: string;
  content: string;
}

export async function generateBlogPost(
  repoDisplayName: string,
  commitData: string,
  retries = 2,
): Promise<GeneratedPost> {
  const client = getClient();

  const systemPrompt = `당신은 소프트웨어 개발 블로그 작성 전문가입니다.
커밋 기록과 코드 변경사항을 분석하여 읽기 좋은 한국어 기술 블로그 포스트를 작성합니다.

규칙:
- 500~1500 단어 사이로 작성
- 개발자가 읽기 좋은 자연스러운 한국어 사용
- 기술적 내용을 쉽게 설명하되, 핵심을 놓치지 않기
- 마크다운 형식으로 작성 (h2, h3, 코드블록, 리스트 활용)
- 커밋 메시지를 그대로 나열하지 말고, 맥락과 의미를 설명
- 왜 이런 변경을 했는지, 어떤 문제를 해결했는지 중심으로 서술

응답 형식 (반드시 이 JSON 형식으로):
{
  "title": "포스트 제목 (간결하고 흥미로운)",
  "description": "1-2문장 요약",
  "content": "마크다운 본문 (프론트매터 제외)"
}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `다음은 "${repoDisplayName}" 프로젝트의 최근 커밋 기록입니다. 이를 바탕으로 블로그 포스트를 작성해 주세요.\n\n${commitData}`,
          },
        ],
      });

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');

      const parsed = JSON.parse(jsonMatch[0]) as GeneratedPost;

      console.log(
        `  [Claude] Tokens: input=${response.usage.input_tokens}, output=${response.usage.output_tokens}`,
      );

      return parsed;
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`  [Claude] Retry ${attempt + 1}/${retries}:`, (err as Error).message);
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }

  throw new Error('Unreachable');
}
