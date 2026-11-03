import subprocess, sys, re
R="/home/claude/acreos"
TESTS=["tests/unit/clerkAuthV2Shape.test.ts","tests/unit/clerkAuthNoObjectReads.test.ts","tests/unit/requireClerkMFA.test.ts","tests/unit/e2eTokenTrafficSkipsUserRateLimit.test.ts","tests/unit/clerkAuth-suffixed-session.test.ts","tests/unit/clerkAuthRealSdkShape.test.ts"]
M=[
("M1 helper stops invoking the callable","server/types/request.ts",'const fields = typeof raw === "function" ? raw() : raw;','const fields = raw as RawClerkAuthFields;'),
("M2 hydrateUser reads req.auth as object","server/auth/clerkAuth.ts","let userId = getClerkAuth(req)?.userId;","let userId = req.auth?.userId;"),
("M3 bypass back to plain object","server/auth/clerkAuth.ts","req.auth = () => ({ userId: testUserId });","req.auth = { userId: testUserId };"),
("M4 signed-out verdict treated as final","server/auth/clerkAuth.ts","  if (getClerkAuth(req)?.userId) {\n    return hydrateUser(req, res, next);\n  }\n","  if (getClerkAuth(req)?.userId) {\n    return hydrateUser(req, res, next);\n  }\n  if (getClerkAuth(req)) {\n    return res.status(401).json({ error: \"Unauthorized\", message: \"No valid session\" });\n  }\n"),
("M5 MFA back to inline cast","server/middleware/requireClerkMFA.ts","const auth = getClerkAuth(req);","const auth = (req as Request & { auth?: { userId?: string; factorVerificationAge?: [number, number] | null } }).auth;"),
("M6 Pax gate drops req.user fallback","server/middleware/requirePaxDisclosure.ts","getClerkAuth(req)?.userId ?? req.user?.clerkUserId ?? undefined","getClerkAuth(req)?.userId"),
("M7 cast-form read reintroduced elsewhere","server/routes-setup.ts","getClerkAuth(req)?.userId ?? req.user","(req as any).auth?.userId ?? req.user"),
("M8 fallback grace widened 30s->300s","server/auth/clerkAuth.ts","const GRACE_PERIOD_MS = 30 * 1000;","const GRACE_PERIOD_MS = 300 * 1000;"),
]
for name,f,a,b in M:
    p=f"{R}/{f}"; s=open(p).read(); assert s.count(a)==1,(name,s.count(a))
    open(p,"w").write(s.replace(a,b))
    r=subprocess.run(["npx","vitest","run",*TESTS],cwd=R,capture_output=True,text=True)
    subprocess.run(["git","checkout","--",f],cwd=R,check=True)
    out=r.stdout+r.stderr
    tests=re.search(r"Tests\s+(.*)",out); fails=sorted(set(re.findall(r"FAIL\s+(tests/\S+)",out)))
    print(f"{name}: exit={r.returncode} | {tests.group(1).strip() if tests else '??'} | {', '.join(x.split('/')[-1] for x in fails)}")
print("tree clean:", subprocess.run(["git","status","--porcelain"],cwd=R,capture_output=True,text=True).stdout.strip()=="")
