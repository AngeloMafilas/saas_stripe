import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { Webhook } from "svix";
import { WebhookEvent } from "@clerk/nextjs/server";
import { api } from "./_generated/api";
import stripe from "../src/lib/stripe";
import resend from "../src/lib/resend";
import WelcomeEmail from "../src/emails/WelcomeEmail";

const http = httpRouter();

const clerkWebhook = httpAction(async (ctx, request) => {
	console.log("🔔 Webhook received");
	
	const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
	if (!webhookSecret) {
		console.error("❌ Missing CLERK_WEBHOOK_SECRET");
		throw new Error("Missing CLERK_WEBHOOK_SECRET environment variable");
	}

	const svix_id = request.headers.get("svix-id");
	const svix_signature = request.headers.get("svix-signature");
	const svix_timestamp = request.headers.get("svix-timestamp");

	if (!svix_id || !svix_signature || !svix_timestamp) {
		console.error("❌ Missing svix headers");
		return new Response("Error occurred -- no svix headers", {
			status: 400,
		});
	}

	const payload = await request.json();
	const body = JSON.stringify(payload);

	const wh = new Webhook(webhookSecret);
	let evt: WebhookEvent;

	try {
		evt = wh.verify(body, {
			"svix-id": svix_id,
			"svix-timestamp": svix_timestamp,
			"svix-signature": svix_signature,
		}) as WebhookEvent;
		console.log("✅ Webhook verified");
	} catch (err) {
		console.error("❌ Error verifying webhook:", err);
		return new Response("Error occurred", { status: 400 });
	}

	const eventType = evt.type;
	console.log("📝 Event type:", eventType);

	if (eventType === "user.created") {
		const { id, email_addresses, first_name, last_name } = evt.data;
		const email = email_addresses[0]?.email_address;
		const name = `${first_name || ""} ${last_name || ""}`.trim();

		console.log("👤 Creating user:", { id, email, name });

		try {
			console.log("💳 Creating Stripe customer...");
			const customer = await stripe.customers.create({
				email,
				name,
				metadata: { clerkId: id },
			});
			console.log("✅ Stripe customer created:", customer.id);

			console.log("💾 Saving to Convex...");
			const userId = await ctx.runMutation(api.users.createUser, {
				email,
				name,
				clerkId: id,
				stripeCustomerId: customer.id,
			});
			console.log("✅ User saved to Convex with ID:", userId);

			if (process.env.NODE_ENV === "development") {
				console.log("📧 Sending welcome email...");
				await resend.emails.send({
					from: "MasterClass <onboarding@resend.dev>",
					to: email,
					subject: "Welcome to MasterClass!",
					react: WelcomeEmail({ name, url: process.env.NEXT_PUBLIC_APP_URL! }),
				});
				console.log("✅ Email sent");
			}
		} catch (error) {
			console.error("❌ Error creating user:", error);
			return new Response("Error creating user", { status: 500 });
		}
	}
	
	console.log("✅ Webhook processed successfully");
	return new Response("Webhook processed successfully", { status: 200 });
});

http.route({
	path: "/clerk-webhook",
	method: "POST",
	handler: clerkWebhook,
});

export default http;
