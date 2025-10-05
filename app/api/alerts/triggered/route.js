import { NextResponse } from 'next/server';
import { connectToMongoDB } from '../../../utils/mongodb.js';
import AlertService from '../../../services/AlertService.js';

// GET /api/alerts/triggered - Get triggered alerts
export async function GET(request) {
  try {
    await connectToMongoDB();
    
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const limit = parseInt(searchParams.get('limit')) || 50;
    
    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    const alerts = await AlertService.getTriggeredAlerts(userId, limit);
    
    return NextResponse.json({
      success: true,
      data: alerts
    });
    
  } catch (error) {
    console.error('Error fetching triggered alerts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch triggered alerts' },
      { status: 500 }
    );
  }
}
