# SUBMISSION.md: copy-paste answers

Hard deadline: Sun 2026-10-25 09:30 PT (HACK.md). Aim to have everything confirmed by 09:00 PT.
Anything marked [ADD] still needs filling in.

URL check (curl, follow redirects, 2026-10-25):
- https://calhacks-giving-garden.vercel.app : HTTP 200
- https://github.com/ikshayer/calhacks : HTTP 200
- https://agentverse.ai/agents/details/agent1q2mslcxwezpm5j7y7tyes754pagc3mv4qd3ampfhcm92rx63w3y62qz9vjg/profile : HTTP 200

---

## Part 1: Cal Hacks ASI:One Submission Agent

In ASI:One, message "Cal Hacks ASI:One Submission" agent ("Hi"), then click **Create team (I'm the lead)**.

**Project name**
```
Reel Rehearsal
```

**Table number** (optional)
```
[ADD]
```

**Your name**
```
[ADD]
```

**Your email**
```
[ADD]
```

**Team size including you (1-4)**
```
3
```
(Jamshed, TM/Shayer, Arian. Confirm before submitting.)

**What problem does your project solve?**
```
Small companies with limited budgets, and stealth companies that cannot test unreleased work in public, get one shot at a campaign video. Reel Rehearsal simulates how an audience of 300 residents reacts to the video and passes it along before you post it, then explains what to change. Our demo customer is The Giving Garden, a community farm that needs volunteers.
```

**Public GitHub repository URL**
```
https://github.com/ikshayer/calhacks
```

**Devpost project URL**
```
https://devpost.com/software/simthetic
```

**Demo video URL**
```
[ADD]
```

### Bonus

**How many agents did you build?**
```
3
```
(Only the orchestrator has a public Agentverse profile. The other two agents have no profile URL.)

**Agent profile URLs**
```
https://agentverse.ai/agents/details/agent1q2mslcxwezpm5j7y7tyes754pagc3mv4qd3ampfhcm92rx63w3y62qz9vjg/profile
```

**How many shared chats?**
```
1
```

**Shared chat URLs**
```
[ADD: asi1.ai > open the demo chat > search icon in left sidebar > Current chat > Share chat > copy https://asi1.ai/shared-chat/...]
```

Then: Continue to review > check details > Confirm submission > copy the Team ID and send it to teammates.

---

## Part 2: Devpost

**Project name**
```
Reel Rehearsal
```

**Tagline** (under 200 chars)
```
Find out who shares it before you post it. Upload a campaign video, watch a simulated town of 300 decide, and see what to change, privately.
```

**Built with**
```
SpacetimeDB, TypeScript, React, Vite, three.js, react-three-fiber, Node.js, Python, Fetch.ai uAgents, Agentverse, ASI:One, Apify, JEV (TypeSafe), Anthropic Claude, Whisper, ffmpeg, Remotion, Vercel
```

**Links**
```
Live site: https://calhacks-giving-garden.vercel.app
Repo: https://github.com/ikshayer/calhacks
Agentverse agent: https://agentverse.ai/agents/details/agent1q2mslcxwezpm5j7y7tyes754pagc3mv4qd3ampfhcm92rx63w3y62qz9vjg/profile
Demo video: [ADD]
```

**Prizes to select**
- **Best Use of Fetch.ai**: three uAgents on Agentverse using the Chat Protocol with a mailbox; the whole workflow (send a video, run the simulation, get the report) works inside an ASI:One chat.
- **Best use of Apify**: we scraped 171 reference reels in Giving Garden's niche, filtered them with a JEV niche filter, and use them to ground the analysis and calibrate like/comment rates.
- **Spacetime**: SpacetimeDB is the core real-time backend. It holds the job queue, and its cascade reducer streams the sharing cascade live to the 3D town through subscriptions.

---

## Part 3: Final checklist (in order)

1. [ ] README pushed to https://github.com/ikshayer/calhacks (includes run/test instructions; the Fetch.ai track requires this).
2. [ ] Demo video uploaded and set to **public**; paste the URL into Devpost and the Submission Agent.
3. [ ] ASI:One shared chat link copied (search icon > Current chat > Share chat).
4. [ ] Devpost submitted with all three prizes selected (Fetch.ai, Apify, Spacetime).
5. [ ] Submission Agent: lead clicks **Create team (I'm the lead)**, confirms, shares the Team ID; each teammate clicks **Join with Team ID**. Status shows **Incomplete** until every teammate has joined, then **Submitted**.
6. [ ] Everything confirmed before **09:00 PT** (hard deadline 09:30 PT).
